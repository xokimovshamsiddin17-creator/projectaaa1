const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

// Initial structure
let data = {
    users: [],
    messages: []
};

// Load data from file (Sync is fine for startup)
function load() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(raw);

            // Sanitization pass: convert corrupted Buffer objects to Base64
            const sanitize = (val) => {
                if (val && typeof val === 'object') {
                    if (val.type === 'Buffer' && Array.isArray(val.data)) {
                        return Buffer.from(val.data).toString('base64');
                    }
                    for (let k in val) {
                        val[k] = sanitize(val[k]);
                    }
                }
                return val;
            };
            data = sanitize(parsed);
        } else {
            save(); // Create initial file
        }
    } catch (e) {
        console.error('Error loading data.json:', e);
    }
}

let isSaving = false;
let savePending = false;

// Save data to file asynchronously to prevent blocking event loop on large data
async function save() {
    if (isSaving) {
        savePending = true;
        return;
    }
    isSaving = true;
    savePending = false;
    try {
        const json = JSON.stringify(data, (key, value) => {
            if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
                return Buffer.from(value.data).toString('base64');
            }
            return value;
        }); // removed indentation format to massively speed up stringify & reduce size
        await fsp.writeFile(DATA_FILE, json, 'utf8');
    } catch (e) {
        console.error('Error saving data.json:', e);
    } finally {
        isSaving = false;
        if (savePending) save();
    }
}

// Users collection
const Users = {
    findOne: (query) => {
        return data.users.find(u => {
            for (let k in query) {
                if (u[k] !== query[k]) return false;
            }
            return true;
        }) || null;
    },
    countDocuments: () => data.users.length,
    save: (userDoc) => {
        const idx = data.users.findIndex(u => u.persistentId === userDoc.persistentId);
        if (idx > -1) {
            data.users[idx] = {
                customNickname: null,
                lastNicknameChange: null,
                avatarUrl: null,
                ...data.users[idx],
                ...userDoc
            };
        } else {
            const newUser = {
                customNickname: null,
                lastNicknameChange: null,
                avatarUrl: null,
                ...userDoc
            };
            data.users.push(newUser);
        }
        save();
        return idx > -1 ? data.users[idx] : data.users[data.users.length - 1];
    }
};

// Messages collection
const Messages = {
    find: (query = {}) => {
        let results = data.messages;
        if (query.deletedBy && query.deletedBy.$ne) {
            results = results.filter(m => !m.deletedBy || !m.deletedBy.includes(query.deletedBy.$ne));
        }

        // Handle Private Messages filtering
        if (query.$or) {
            // Complex query for DM history between two users
            results = results.filter(m => {
                return query.$or.some(q => {
                    return Object.keys(q).every(k => m[k] === q[k]);
                });
            });
        } else if (Object.prototype.hasOwnProperty.call(query, 'recipientId')) {
            // Simple global vs private filter
            if (query.recipientId === null) {
                results = results.filter(m => !m.recipientId);
            } else {
                results = results.filter(m => m.recipientId === query.recipientId);
            }
        }

        return {
            sort: (sortQuery) => {
                const sorted = [...results];
                if (sortQuery.createdAt) {
                    sorted.sort((a, b) => {
                        const val = new Date(a.createdAt) - new Date(b.createdAt);
                        return sortQuery.createdAt === 1 ? val : -val;
                    });
                }
                return {
                    limit: (n) => sorted.slice(0, n),
                    lean: () => sorted
                };
            },
            lean: () => results
        };
    },
    findById: (id) => data.messages.find(m => String(m._id) === String(id)) || null,
    findByIdAndDelete: (id) => {
        const idx = data.messages.findIndex(m => String(m._id) === String(id));
        if (idx > -1) {
            data.messages.splice(idx, 1);
            save();
        }
    },
    findByIdAndUpdate: (id, update) => {
        const idx = data.messages.findIndex(m => String(m._id) === String(id));
        if (idx > -1) {
            if (update.$addToSet && update.$addToSet.deletedBy) {
                if (!data.messages[idx].deletedBy) data.messages[idx].deletedBy = [];
                if (!data.messages[idx].deletedBy.includes(update.$addToSet.deletedBy)) {
                    data.messages[idx].deletedBy.push(update.$addToSet.deletedBy);
                }
            } else {
                data.messages[idx] = { ...data.messages[idx], ...update };
            }
            save();
        }
    },
    deleteMany: () => {
        data.messages = [];
        save();
    },
    save: (msgObj) => {
        if (!msgObj._id) msgObj._id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        if (!msgObj.createdAt) msgObj.createdAt = new Date().toISOString();
        data.messages.push(msgObj);
        save();
        return msgObj;
    }
};

// Initialize
load();

module.exports = {
    Users,
    Messages,
    data // for direct access if needed
};
