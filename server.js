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

// Get all messages API (Admin only concept)
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

// Delete single message API (Admin/Global delete)
app.delete('/api/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (mongoConnected && Message) {
            await Message.findByIdAndDelete(id);
        } else {
            const idx = messagesStorage.findIndex(m => String(m._id) === String(id));
            if (idx > -1) messagesStorage.splice(idx, 1);
        }
        io.emit('refreshMessages'); // Refresh broadcast
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Clear all messages
app.get('/clear', async (req, res) => {
    try {
        if (mongoConnected && Message) {
            await Message.deleteMany({});
        }
        messagesStorage = [];
        res.json({ ok: true, msg: 'Hamma xabarlar o\'chirildi' });
        io.emit('refreshMessages', {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Models and State
let Message = null;
let User = null;
let mongoConnected = false;
let messagesStorage = []; // Fallback

const userMap = {}; // socket.id -> anon number (temp)
let anonCounter = 1000;

// Rate limiting
const userMessageTimes = {};
const userCooldown = {};
const MESSAGE_WINDOW = 5000;
const MESSAGE_LIMIT = 4;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/anonim';
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('MongoDB ga ulandi');
        mongoConnected = true;

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
            deletedBy: [{ type: String }], // Array of persistentIds
            createdAt: { type: Date, default: Date.now }
        });
        Message = mongoose.model('Message', messageSchema);

        const userSchema = new mongoose.Schema({
            persistentId: { type: String, unique: true, required: true },
            anonId: { type: Number, unique: true, required: true },
            createdAt: { type: Date, default: Date.now }
        });
        User = mongoose.model('User', userSchema);
    })
    .catch(err => {
        console.warn('MongoDB ulanmadi, in-memory storage ishlatilmoqda:', err.message);
    });

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB for voice
});

io.on('connection', async (socket) => {
    console.log('Yangi foydalanuvchi ulandi:', socket.id);

    // Initial temp anon
    userMap[socket.id] = anonCounter++;
    socket.emit('me', { anonId: userMap[socket.id] });

    socket.on('setUserId', async (pid) => {
        try {
            if (!pid) return;
            socket.persistentId = String(pid);

            if (mongoConnected && User) {
                let user = await User.findOne({ persistentId: pid });
                if (!user) {
                    const count = await User.countDocuments();
                    user = new User({ persistentId: pid, anonId: 1000 + count });
                    await user.save();
                }
                userMap[socket.id] = user.anonId;
            }

            socket.emit('me', { anonId: userMap[socket.id] });

            // Re-send messages filtered for this user
            let recent = [];
            if (mongoConnected && Message) {
                recent = await Message.find({ deletedBy: { $ne: socket.persistentId } }).sort({ createdAt: 1 }).limit(100).lean();
            } else {
                recent = messagesStorage.filter(m => !m.deletedBy || !m.deletedBy.includes(socket.persistentId)).slice(-100);
            }
            socket.emit('initMessages', recent);
        } catch (e) {
            console.error('setUserId error:', e);
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

        let msgObj = {
            author: `Anonim-${userMap[socket.id] || 'anon'}`,
            createdAt: new Date(),
            socketId: socket.id,
            persistentId: socket.persistentId || null
        };

        if (typeof msgData === 'object' && msgData !== null) {
            msgObj.type = msgData.type || 'text';
            if (msgObj.type === 'voice') {
                msgObj.audio = msgData.audio;
                msgObj.duration = msgData.duration;
            } else {
                msgObj.text = String(msgData.text || '').trim();
                if (!msgObj.text) return;
            }
            if (msgData.replyTo) msgObj.replyTo = msgData.replyTo;
        } else {
            return;
        }

        if (msgObj.replyTo) {
            try {
                let orig = mongoConnected ? await Message.findById(msgObj.replyTo).lean() : messagesStorage.find(m => m._id == msgObj.replyTo);
                if (orig) {
                    msgObj.replyAuthor = orig.author;
                    msgObj.replyText = orig.text || '[Ovoz]';
                }
            } catch (e) { }
        }

        try {
            if (mongoConnected && Message) {
                const doc = new Message(msgObj);
                const saved = await doc.save();
                msgObj._id = saved._id;
            } else {
                msgObj._id = Date.now();
                messagesStorage.push(msgObj);
            }
            io.emit('newMessage', msgObj);
        } catch (err) {
            console.error('Save failed:', err);
        }
    });

    socket.on('deleteForMe', async (msgId) => {
        try {
            if (!socket.persistentId || !msgId) return;
            if (mongoConnected && Message) {
                await Message.findByIdAndUpdate(msgId, { $addToSet: { deletedBy: socket.persistentId } });
            } else {
                const msg = messagesStorage.find(m => m._id == msgId);
                if (msg) {
                    if (!msg.deletedBy) msg.deletedBy = [];
                    if (!msg.deletedBy.includes(socket.persistentId)) msg.deletedBy.push(socket.persistentId);
                }
            }
            socket.emit('messageDeletedLocally', msgId);
        } catch (e) {
            console.error('deleteForMe error:', e);
        }
    });

    socket.on('disconnect', () => {
        delete userMap[socket.id];
        delete userMessageTimes[socket.id];
        delete userCooldown[socket.id];
        io.emit('userCount', io.engine.clientsCount);
    });

    io.emit('userCount', io.engine.clientsCount);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
