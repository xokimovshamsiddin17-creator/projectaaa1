// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();

// Serve frontend from root directory
app.use(express.static(__dirname));

// Simple health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Get all messages API
app.get('/api/messages', async (req, res) => {
    try {
        let messages = [];
        if (mongoConnected && Message) {
            messages = await Message.find({}).sort({ createdAt: -1 }).lean();
        } else {
            messages = messagesStorage.slice().reverse();
        }
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete single message API
app.delete('/api/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (mongoConnected && Message) {
            await Message.findByIdAndDelete(id);
        } else {
            const idx = messagesStorage.findIndex(m => String(m._id) === String(id));
            if (idx > -1) messagesStorage.splice(idx, 1);
        }
        io.emit('newMessage'); // Refresh broadcast
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Clear all messages (for admin/testing)
app.get('/clear', async (req, res) => {
    try {
        if (mongoConnected && Message) {
            await Message.deleteMany({});
        }
        messagesStorage = [];
        res.json({ ok: true, msg: 'Hamma xabarlar o\'chirildi' });
        // Broadcast to all clients to refresh
        io.emit('refreshMessages', {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// In-memory message storage (fallback)
let messagesStorage = [];
let Message = null;
let mongoConnected = false;
// Map socket.id -> anon number
const userMap = {};
// Map persistent client ID (from localStorage) -> anon number
const persistentMap = {};
let anonCounter = 1000;

// Rate limiting: track message timestamps in a rolling window (5 seconds)
const userMessageTimes = {}; // socket.id -> array of timestamps
const userCooldown = {}; // socket.id -> cooldown end time
const MESSAGE_WINDOW = 5000; // 5 second time window
const MESSAGE_LIMIT = 4; // Max messages in window

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/anonim';
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log('MongoDB ga ulandi');
        mongoConnected = true;
            // Message model (supports text and sticker types)
            const messageSchema = new mongoose.Schema({
                text: { type: String },
                sticker: { type: String },
                type: { type: String, enum: ['text', 'sticker', 'voice'], default: 'text' },
                author: { type: String, default: 'Anonim' },
                persistentId: { type: String },
                audio: { type: String },
                duration: { type: Number },
                socketId: { type: String },
                replyTo: { type: String },
                replyAuthor: { type: String },
                replyText: { type: String },
                createdAt: { type: Date, default: Date.now }
            });
            Message = mongoose.model('Message', messageSchema);
    })
    .catch(err => {
        console.warn('MongoDB ulanmadi, in-memory storage ishlatilmoqda:', err.message);
    });

// HTTP server va Socket.io
const server = http.createServer(app);
const io = new Server(server);

// Real-time chat
io.on('connection', async (socket) => {
    console.log('Yangi foydalanuvchi ulandi, Socket ID:', socket.id);
    // assign temporary anonymous short id to this socket
    const myAnonTemp = anonCounter++;
    userMap[socket.id] = myAnonTemp;
    // tell this client its anon id (may be updated if client provides persistent ID)
    socket.emit('me', { anonId: myAnonTemp });

    // If client provides a persistent ID (from localStorage), they will emit 'setUserId'.
    // Listen for that and tie the persistent ID to a stable anon number.
    socket.on('setUserId', (pid) => {
        try {
            if (!pid) return;
            socket.persistentId = String(pid);
            // If we've seen this persistent ID before, reuse its anon number.
            if (persistentMap[pid]) {
                userMap[socket.id] = persistentMap[pid];
            } else {
                // Otherwise, bind current temp anon to this persistent ID so it stays stable.
                persistentMap[pid] = userMap[socket.id];
            }
            // Inform client of their stable anon id
            socket.emit('me', { anonId: userMap[socket.id] });
            console.log('Persistent ID set for', socket.id, '->', pid, 'anon:', userMap[socket.id]);
        } catch (e) {
            console.warn('setUserId handler error:', e && e.message);
        }
    });

    // Send recent messages to newly connected client
    try {
        let recent = [];
        if (mongoConnected && Message) {
            recent = await Message.find({}).sort({ createdAt: 1 }).limit(200).lean();
        } else {
            recent = messagesStorage.slice(-200);
        }
        console.log('Yuborilgan xabarlar soni:', recent.length);
        socket.emit('initMessages', recent);
        // Broadcast current user count to all clients (use sockets map size for accuracy)
        const count = (io.sockets && io.sockets.sockets) ? io.sockets.sockets.size : (io.engine.clientsCount || 0);
        io.emit('userCount', count);
    } catch (err) {
        console.error('Xabarlar olinmadi:', err);
        socket.emit('initMessages', messagesStorage.slice(-200));
    }

    // Yangi xabar kelganda: saqlash va hamma klientga yuborish
    socket.on('sendMessage', async (msgText) => {
        console.log('Xabar keldi:', msgText);

        // Check if user is in cooldown
        const now = Date.now();
        if (userCooldown[socket.id] && userCooldown[socket.id] > now) {
            const remainingTime = Math.ceil((userCooldown[socket.id] - now) / 1000);
            console.log(`Foydalanuvchi rajhda: ${socket.id}, kutish vaqti: ${remainingTime}s`);
            socket.emit('cooldown', { remainingTime });
            return;
        }

        // Time-window based rate limiting
        if (!userMessageTimes[socket.id]) {
            userMessageTimes[socket.id] = [];
        }
        
        // Remove messages older than MESSAGE_WINDOW
        userMessageTimes[socket.id] = userMessageTimes[socket.id].filter(t => now - t < MESSAGE_WINDOW);
        
        // Add current message timestamp
        userMessageTimes[socket.id].push(now);
        
        // Check if limit exceeded
        if (userMessageTimes[socket.id].length > MESSAGE_LIMIT) {
            console.log(`${socket.id} 4 ta tezda xabar yuborgani, 10 soniyaga rajh qo'yildi`);
            userCooldown[socket.id] = now + 10000;
            userMessageTimes[socket.id] = []; // Reset the array
            socket.emit('cooldown', { remainingTime: 10 });
            // Still save and broadcast this 4th message before blocking
        }

        // accept either string or object {type, text, sticker, replyTo}

        let msgObj = { author: `Anonim-${userMap[socket.id] || 'anon'}`, createdAt: new Date(), type: 'text', socketId: socket.id, persistentId: socket.persistentId || null };
        if (typeof msgText === 'string') {
            if (!msgText.trim()) return;
            msgObj.text = msgText.trim();
        } else if (typeof msgText === 'object' && msgText !== null) {
            if (msgText.type === 'voice') {
                msgObj.type = 'voice';
                msgObj.audio = String(msgText.audio || '');
                msgObj.duration = msgText.duration || 0;
                if (!msgObj.audio) return;
            } else if (msgText.type === 'sticker') {
                msgObj.type = 'sticker';
                msgObj.sticker = String(msgText.sticker || '').slice(0, 200);
            } else {
                msgObj.type = 'text';
                msgObj.text = String(msgText.text || '').trim();
                if (!msgObj.text) return;
            }
            // preserve replyTo if present
            if (msgText.replyTo) msgObj.replyTo = String(msgText.replyTo);
        } else {
            console.warn('Xabar noto\'g\'ri format');
            return;
        }

        // If this message is a reply, try to fetch original message excerpt
        if (msgObj.replyTo) {
            try {
                let orig = null;
                if (mongoConnected && Message) {
                    orig = await Message.findById(msgObj.replyTo).lean();
                } else {
                    orig = messagesStorage.find(m => String(m._id) === String(msgObj.replyTo));
                }
                if (orig) {
                    msgObj.replyAuthor = orig.author || 'Anonim';
                    msgObj.replyText = orig.type === 'sticker' ? (orig.sticker || '') : (orig.text || '');
                }
            } catch (e) {
                console.warn('Reply original topilmadi', e.message);
            }
        }

        try {
            if (mongoConnected && Message) {
                const doc = new Message(msgObj);
                const saved = await doc.save();
                msgObj._id = saved._id;
                msgObj.createdAt = saved.createdAt;
            } else {
                // generate simple id for in-memory messages
                msgObj._id = `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
                messagesStorage.push(msgObj);
            }
            
            console.log(`Xabar saqland va yuborildi: ${msgObj.text || msgObj.sticker || '[Ovoz xabari]'}`);
            io.emit('newMessage', msgObj);
            
            // also emit updated user count (in case)
            const count2 = (io.sockets && io.sockets.sockets) ? io.sockets.sockets.size : (io.engine.clientsCount || 0);
            io.emit('userCount', count2);
        } catch (err) {
            console.error('Xabar saqlanmadi:', err);
            messagesStorage.push(msgObj);
            io.emit('newMessage', msgObj);
        }
    });

    socket.on('disconnect', () => {
        console.log('Foydalanuvchi uzildi:', socket.id);
        // remove mapping and broadcast user count
        delete userMap[socket.id];
        delete userMessageTimes[socket.id];
        delete userCooldown[socket.id];
        const count3 = (io.sockets && io.sockets.sockets) ? io.sockets.sockets.size : (io.engine.clientsCount || 0);
        io.emit('userCount', count3);
    });
});

// Serverni ishga tushirish
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server ishga tushdi: http://localhost:${PORT}`));
