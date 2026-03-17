// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
// Data storage (JSON based)
const db = require('./db.js');
const Message = db.Messages;
const User = db.Users;

const dbReady = true; 

// Initialize Telegram Bot
const botModule = require('./bot.js');
const getBotSettings = botModule.getSettings;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(__dirname));

// Simple health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// User Info API
app.get('/api/user/:pid', async (req, res) => {
    try {
        const user = await User.findOne({ persistentId: req.params.pid });
        if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
        res.json({
            persistentId: user.persistentId,
            anonId: user.anonId,
            customNickname: user.customNickname,
            avatarUrl: user.avatarUrl,
            lastNicknameChange: user.lastNicknameChange
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Nickname API
app.post('/api/update-nickname', async (req, res) => {
    try {
        const { persistentId, newNickname } = req.body;
        if (!persistentId || !newNickname) return res.status(400).json({ error: 'Ma\'lumotlar yetarli emas' });
        
        const user = User.findOne({ persistentId });
        if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

        const now = new Date();
        if (user.lastNicknameChange) {
            const lastChange = new Date(user.lastNicknameChange);
            const diffTime = Math.abs(now - lastChange);
            const diffDays = diffTime / (1000 * 60 * 60 * 24);
            
            if (diffDays < 14) {
                const daysLeft = Math.ceil(14 - diffDays);
                return res.status(400).json({ 
                    error: `⚠️ Kechirasiz, ismni har 14 kunda faqat bir marta o'zgartirish mumkin.\nYana ${daysLeft} kun kuting.` 
                });
            }
        }

        user.customNickname = newNickname.trim().slice(0, 30);
        user.lastNicknameChange = now.toISOString();
        User.save(user);

        // SYNC: Update userMap and notify active sockets for this persistentId
        for (const [sid, data] of Object.entries(userMap)) {
            if (data.persistentId === persistentId) {
                userMap[sid].customNickname = user.customNickname;
                const socket = io.sockets.sockets.get(sid);
                if (socket) {
                    socket.emit('me', userMap[sid]);
                }
            }
        }

        res.json({ ok: true, customNickname: user.customNickname });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Avatar API (Supports Base64 gallery upload)
app.post('/api/update-avatar', async (req, res) => {
    try {
        const { persistentId, avatarUrl, base64 } = req.body;
        if (!persistentId) return res.status(400).json({ error: 'Ma\'lumotlar yetarli emas' });
        
        const user = User.findOne({ persistentId });
        if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

        let finalAvatarUrl = avatarUrl;

        if (base64) {
            // Save base64 as file
            const fileName = `avatar_${persistentId}_${Date.now()}.png`;
            const filePath = path.join(__dirname, 'uploads', fileName);
            const base64Data = base64.replace(/^data:image\/\w+;base64,/, "");
            fs.writeFileSync(filePath, base64Data, 'base64');
            finalAvatarUrl = `/uploads/${fileName}`;
        }

        user.avatarUrl = finalAvatarUrl;
        User.save(user);

        // SYNC: Update userMap and notify active sockets
        for (const [sid, data] of Object.entries(userMap)) {
            if (data.persistentId === persistentId) {
                userMap[sid].avatarUrl = user.avatarUrl;
                const socket = io.sockets.sockets.get(sid);
                if (socket) {
                    socket.emit('me', userMap[sid]);
                }
            }
        }

        res.json({ ok: true, avatarUrl: user.avatarUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve uploads folder
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Get all messages API (Admin only concept)
app.get('/api/messages', async (req, res) => {
    try {
        const messages = Message.find({}).sort({ createdAt: -1 }).lean();
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete single message API (Admin/Global delete)
app.delete('/api/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        Message.findByIdAndDelete(id);
        io.emit('refreshMessages'); // Refresh broadcast
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


const userMap = {}; // socket.id -> { anonId, customNickname, avatarUrl, persistentId }

// Rate limiting
const userMessageTimes = {};
const userCooldown = {};
const MESSAGE_WINDOW = 5000;
const MESSAGE_LIMIT = 4;

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB for voice
});

const broadcastOnlineUsers = () => {
    const uniqueUsers = {};
    const pids = new Set();
    let anonCount = 0;

    Object.entries(userMap).forEach(([sid, u]) => {
        if (u.persistentId) {
            uniqueUsers[u.persistentId] = u;
            pids.add(u.persistentId);
        } else {
            anonCount++;
        }
    });

    const onlineList = Object.values(uniqueUsers);
    io.emit('onlineUsers', onlineList);
    
    // Total unique = unique persistent IDs + count of anonymous connections
    const totalUnique = pids.size + anonCount;
    io.emit('userCount', totalUnique);
};

io.on('connection', async (socket) => {
    console.log('Yangi foydalanuvchi ulandi:', socket.id);

    // Initial temp anon based on current user count + constant
    const baseAnon = 1000 + User.countDocuments();
    userMap[socket.id] = { anonId: baseAnon, persistentId: null };
    socket.emit('me', { anonId: userMap[socket.id].anonId });
    broadcastOnlineUsers();

    socket.on('setUserId', async (pid) => {
        try {
            if (pid) {
                socket.persistentId = String(pid);
                let user = User.findOne({ persistentId: pid });
                if (!user) {
                    const count = User.countDocuments();
                    user = { persistentId: pid, anonId: 1000 + count, createdAt: new Date().toISOString() };
                    User.save(user);
                }
                userMap[socket.id] = {
                    anonId: user.anonId,
                    customNickname: user.customNickname,
                    avatarUrl: user.avatarUrl,
                    persistentId: user.persistentId
                };
                broadcastOnlineUsers(); // Notify everyone
            }

            // Also send the current list specifically to this new user
            const uniqueUsers = {};
            Object.values(userMap).forEach(u => {
                if (u.persistentId) uniqueUsers[u.persistentId] = u;
            });
            socket.emit('onlineUsers', Object.values(uniqueUsers));

            socket.emit('me', userMap[socket.id]);

            // Default: Send global messages
            const recent = Message.find({ 
                recipientId: null,
                deletedBy: { $ne: socket.persistentId } 
            }).sort({ createdAt: 1 }).limit(100);
            socket.emit('initMessages', recent);
        } catch (e) {
            console.error('setUserId error:', e);
        }
    });

    socket.on('loadPrivateMessages', async (otherPid) => {
        try {
            if (!socket.persistentId || !otherPid) return;
            const history = Message.find({
                $or: [
                    { persistentId: socket.persistentId, recipientId: String(otherPid) },
                    { persistentId: String(otherPid), recipientId: socket.persistentId }
                ],
                deletedBy: { $ne: socket.persistentId }
            }).sort({ createdAt: 1 }).limit(100);
            socket.emit('initMessages', history);
        } catch (e) {
            console.error('loadPrivateMessages error:', e);
        }
    });

    socket.on('sendMessage', async (msgData) => {
        const now = Date.now();
        if (userCooldown[socket.id] && userCooldown[socket.id] > now) {
            socket.emit('cooldown', { remainingTime: Math.ceil((userCooldown[socket.id] - now) / 1000) });
            return;
        }

        if (!userMessageTimes[socket.id]) userMessageTimes[socket.id] = [];
        userMessageTimes[socket.id] = userMessageTimes[socket.id].filter(t => now - t < MESSAGE_WINDOW);
        userMessageTimes[socket.id].push(now);

        if (userMessageTimes[socket.id].length > MESSAGE_LIMIT) {
            userCooldown[socket.id] = now + 10000;
            socket.emit('cooldown', { remainingTime: 10 });
            return;
        }

        const userData = userMap[socket.id] || {};
        const authorName = userData.customNickname || `Anonim-${userData.anonId || 'anon'}`;

        let msgObj = {
            author: authorName,
            avatarUrl: userData.avatarUrl || null,
            createdAt: new Date(),
            socketId: socket.id,
            persistentId: socket.persistentId || null,
            recipientId: msgData.recipientId || null
        };

        if (typeof msgData === 'object' && msgData !== null) {
            msgObj.type = msgData.type || 'text';
            if (msgObj.type === 'voice') {
                // Buffer to Base64 for storage
                msgObj.audio = msgData.audioData ? msgData.audioData.toString('base64') : msgData.audio;
                msgObj.duration = msgData.duration;
            } else if (msgObj.type === 'image') {
                // Buffer to Base64 for storage
                msgObj.imageUrl = msgData.fileData ? `data:image/jpeg;base64,${msgData.fileData.toString('base64')}` : msgData.imageUrl;
            } else if (msgObj.type === 'file') {
                // Buffer to Base64 for storage
                msgObj.fileUrl = msgData.fileData ? `data:application/octet-stream;base64,${msgData.fileData.toString('base64')}` : msgData.fileUrl;
                msgObj.fileName = msgData.fileName;
                msgObj.fileSize = msgData.fileSize;
            } else if (msgObj.type === 'sticker') {
                msgObj.stickerUrl = msgData.stickerUrl;
            } else {
                msgObj.text = String(msgData.text || '').trim();
                if (!msgObj.text && msgObj.type === 'text') return;
            }
            if (msgData.replyTo) msgObj.replyTo = msgData.replyTo;
        } else {
            return;
        }

        if (msgObj.replyTo) {
            try {
                let orig = Message.findById(msgObj.replyTo);
                if (orig) {
                    msgObj.replyAuthor = orig.author;
                    msgObj.replyText = orig.text || '[Ovoz]';
                    
                    if (orig.persistentId && orig.persistentId !== socket.persistentId) {
                        botModule.sendReplyNotification(orig.persistentId, authorName);
                    }
                }
            } catch (e) { }
        }

        try {
            const saved = Message.save(msgObj);
            msgObj._id = saved._id;

            if (msgObj.recipientId) {
                // Private message
                for (const [sid, u] of Object.entries(userMap)) {
                    if (u.persistentId === msgObj.recipientId || u.persistentId === socket.persistentId) {
                        io.to(sid).emit('newMessage', msgObj);
                    }
                }
            } else {
                // Global message
                io.emit('newMessage', msgObj);
            }
        } catch (err) {
            console.error('Save failed:', err);
        }
    });

    socket.on('deleteForMe', async (msgId) => {
        try {
            if (!socket.persistentId || !msgId) return;
            await Message.findByIdAndUpdate(msgId, { $addToSet: { deletedBy: socket.persistentId } });
            socket.emit('messageDeletedLocally', msgId);
        } catch (e) {
            console.error('deleteForMe error:', e);
        }
    });

    socket.on('disconnect', () => {
        delete userMap[socket.id];
        delete userMessageTimes[socket.id];
        delete userCooldown[socket.id];
        broadcastOnlineUsers();
    });

    broadcastOnlineUsers();
});

// SPA catch-all: serve React index.html for any non-API route
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        // Fallback for development (assuming public/index.html or similar)
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
