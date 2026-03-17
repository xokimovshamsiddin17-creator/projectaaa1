const socket = io();

// UI Elements
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const voiceBtn = document.getElementById('voiceBtn');
const recordingIndicator = document.getElementById('recording-indicator');
const recordingTime = document.getElementById('recording-time');
const themeBtn = document.getElementById('themeBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const userCountEl = document.getElementById('userCount');
const replyPreviewEl = document.getElementById('replyPreview');
const replyUserEl = document.getElementById('replyUser');
const replyTextEl = document.getElementById('replyText');
const cancelReplyBtn = document.getElementById('cancelReply');
const cancelRecordBtn = document.getElementById('cancelRecordBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');

// Sidebar & Chat Elements
const sidebar = document.getElementById('sidebar');
const chatList = document.getElementById('chatList');
const chatSearch = document.getElementById('chatSearch');
const globalChatItem = document.getElementById('globalChatItem');
const backBtn = document.getElementById('backBtn');
const chatTitle = document.getElementById('chatTitle');

// Settings Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const nicknameInput = document.getElementById('nicknameInput');
const saveNicknameBtn = document.getElementById('saveNickname');
const myAvatarImg = document.getElementById('myAvatar');

// Nav Drawer & Lightbox Elements
const hamburgerBtn = document.getElementById('hamburgerBtn');
const navDrawerOverlay = document.getElementById('navDrawerOverlay');
const navDrawer = document.getElementById('navDrawer');
const drawerAvatar = document.getElementById('drawerAvatar');
const drawerName = document.getElementById('drawerName');
const drawerAnon = document.getElementById('drawerAnon');
const drawerProfileBtn = document.getElementById('drawerProfileBtn');
const drawerThemeBtn = document.getElementById('drawerThemeBtn');
const drawerCacheBtn = document.getElementById('drawerCacheBtn');

const lightboxOverlay = document.getElementById('lightboxOverlay');
const closeLightbox = document.getElementById('closeLightbox');
const lightboxImage = document.getElementById('lightboxImage');
const downloadLightbox = document.getElementById('downloadLightbox');



// Generate or retrieve persistent user ID
let myUserId = localStorage.getItem('chatUserId');
if (!myUserId) {
    myUserId = 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('chatUserId', myUserId);
}

let mySocketId = null;
let currentProfile = {
    customNickname: null,
    avatarUrl: null
};

// Phase 2 state: track last message and unreads for sidebar
const chatsState = {
    global: { lastMsg: 'Xabarlar yuboring...', lastTime: '', unread: 0 },
};

// Phase 3: Persistent Recent Chats
let recentChats = JSON.parse(localStorage.getItem('recentChats') || '[]');

function getAvatarColor(id) {
    if (!id) return '3498db'; // Default blue
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const color = Math.floor(Math.abs((Math.sin(hash) * 10000) % 1 * 16777215)).toString(16);
    return color.padStart(6, '0');
}

function updateProfileUI() {
    const name = currentProfile.customNickname || 'A';
    const dpColor = getAvatarColor(myUserId);
    const avatarSrc = currentProfile.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${dpColor}&color=fff`;

    if (myAvatarImg) {
        myAvatarImg.src = avatarSrc;
    }
    if (drawerAvatar) {
        drawerAvatar.src = avatarSrc;
    }
    if (drawerName) drawerName.textContent = currentProfile.customNickname || 'Anonim';
    if (drawerAnon) drawerAnon.textContent = `ID: ${currentProfile.anonId || 'Noma\'lum'}`;

    // Update self in sidebar if exists
    const meItem = document.querySelector(`[data-pid="${myUserId}"]`);
    if (meItem) {
        const itemAvatar = meItem.querySelector('.chat-item-avatar');
        if (itemAvatar) {
            itemAvatar.outerHTML = `<img class="chat-item-avatar" src="${avatarSrc}" alt="Avatar">`;
        }
        const itemName = meItem.querySelector('.chat-item-name');
        if (itemName) itemName.textContent = name + ' (Siz)';
    }
}

// Phase 5: Stickers
const STICKERS = [
    'https://telegram.org/file/464001642/1/uIByZpB4A5Q.20173/7ec09e075677864f1d',
    'https://telegram.org/file/464001141/2/p3zU5Z6L9kE.142312/03f0b240f252ea9d61',
    'https://telegram.org/file/464001150/1/kZp78v4f5uQ.21541/9a410313f0449e771e',
    'https://telegram.org/file/464001874/1/sL3UqR3cT0k.25143/8d38403d50849e771a',
    'https://telegram.org/file/464001880/1/aVq8vR3Lp5k.18432/9b28403d50849e771b',
    'https://telegram.org/file/464001890/2/kVp98v4Lp5k.221412/1c28403d50849e771c',
];

function initStickerPicker() {
    const grid = document.getElementById('stickerGrid');
    const picker = document.getElementById('stickerPicker');
    const btn = document.getElementById('stickerBtn');

    STICKERS.forEach(url => {
        const item = document.createElement('div');
        item.className = 'sticker-item';
        item.innerHTML = `<img src="${url}" alt="Sticker">`;
        item.onclick = () => {
            sendSticker(url);
            picker.style.display = 'none';
        };
        grid.appendChild(item);
    });

    btn.onclick = (e) => {
        e.stopPropagation();
        picker.style.display = picker.style.display === 'flex' ? 'none' : 'flex';
    };

    document.addEventListener('click', () => picker.style.display = 'none');
    picker.onclick = (e) => e.stopPropagation();
}

initStickerPicker();

// Performance Optimization: Image Compression
async function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_SIZE = 1280;

                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', 0.7);
            };
        };
    });
}

// File Upload Logic
attachBtn.onclick = () => fileInput.click();

fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    let finalFile = file;
    const isImage = file.type.startsWith('image/');
    
    if (isImage) {
        const blob = await compressImage(file);
        finalFile = blob;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const base64 = reader.result;
        const payload = {
            type: isImage ? 'image' : 'file',
            persistentId: myUserId,
            recipientId: currentRecipientId || null,
            imageUrl: isImage ? base64 : null,
            fileUrl: isImage ? null : base64,
            fileName: isImage ? null : file.name,
            fileSize: isImage ? null : formatBytes(file.size)
        };

        if (replyToId) payload.replyTo = replyToId;
        socket.emit('sendMessage', payload);
        
        replyToId = null;
        replyPreviewEl.style.display = 'none';
        fileInput.value = '';
    };
    reader.readAsDataURL(finalFile);
};

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function saveRecentChat(user) {
    if (!user.persistentId || user.persistentId === myUserId) return;
    const existingIndex = recentChats.findIndex(c => c.persistentId === user.persistentId);
    if (existingIndex !== -1) {
        recentChats.splice(existingIndex, 1);
    }
    recentChats.unshift({
        persistentId: user.persistentId,
        customNickname: user.customNickname,
        avatarUrl: user.avatarUrl,
        anonId: user.anonId
    });
    recentChats = recentChats.slice(0, 50); // Keep last 50
    localStorage.setItem('recentChats', JSON.stringify(recentChats));
}

socket.on('connect', () => {
    mySocketId = socket.id;
    socket.emit('setUserId', myUserId);
});


// Message cache
const CACHE_KEY = 'chatMessages_v3';
let cachedMessages = [];

function saveCachedMessages(arr) {
    try {
        cachedMessages = (arr || []).slice(-100);
        // Reduce localStorage size and prevent UI freezing (tez ishlashi uchun)
        const toCache = cachedMessages.map(m => {
            const m2 = { ...m };
            if (m2.audio && m2.audio.length > 500) m2.audio = '';
            if (m2.audioData && m2.audioData.length > 500) m2.audioData = '';
            if (m2.fileData && m2.fileData.length > 500) m2.fileData = '';
            if (m2.imageUrl && m2.imageUrl.length > 500) m2.imageUrl = '';
            if (m2.fileUrl && m2.fileUrl.length > 500) m2.fileUrl = '';
            return m2;
        });
        localStorage.setItem(CACHE_KEY, JSON.stringify(toCache));
    } catch (e) { }
}

function loadCachedMessages() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return;
        cachedMessages = JSON.parse(raw);
        messagesContainer.innerHTML = '';
        cachedMessages.forEach(msg => addMessage(msg, false));
        scrollToBottom();
    } catch (e) { }
}

localStorage.removeItem(CACHE_KEY); // Purge old binary data
loadCachedMessages();

// Socket Events
socket.on('initMessages', (msgs) => {
    messagesContainer.innerHTML = '';
    msgs.forEach(msg => addMessage(msg, false));
    if (currentRecipientId === null) {
        saveCachedMessages(msgs);
    }
    scrollToBottom();
});

socket.on('me', (data) => {
    currentProfile = data;
    updateProfileUI();
});

socket.on('newMessage', (msg) => {
    const isGlobalMsg = msg.recipientId === null;
    const isCurrentlyGlobal = currentRecipientId === null;
    const senderId = msg.persistentId;
    const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const previewText = msg.type === 'voice' ? '🎤 Ovozli xabar' : msg.text;

    // Update internal state for sidebar
    if (isGlobalMsg) {
        chatsState.global = { lastMsg: previewText, lastTime: time, unread: isCurrentlyGlobal ? 0 : (chatsState.global.unread + 1) };
    } else {
        const otherId = senderId === myUserId ? msg.recipientId : senderId;
        if (!chatsState[otherId]) {
            chatsState[otherId] = { unread: 0, name: msg.author, avatar: msg.avatarUrl };
        }
        const isCurrentPrivate = currentRecipientId === otherId;
        chatsState[otherId].lastMsg = previewText;
        chatsState[otherId].lastTime = time;
        if (!isCurrentPrivate) {
            chatsState[otherId].unread++;
        }
    }

    // Refresh Sidebar UI
    refreshSidebarItem(isGlobalMsg ? 'global' : (senderId === myUserId ? msg.recipientId : senderId));

    if (isCurrentlyGlobal && isGlobalMsg) {
        addMessage(msg, true);
        cachedMessages.push(msg);
        saveCachedMessages(cachedMessages);
    } else if (!isCurrentlyGlobal && !isGlobalMsg) {
        const involveMe = msg.persistentId === myUserId || msg.recipientId === myUserId;
        const involveThem = msg.persistentId === currentRecipientId || msg.recipientId === currentRecipientId;
        
        if (involveMe && involveThem) {
            addMessage(msg, true);
        } else if (msg.recipientId === myUserId) {
            showNotification(msg);
        }
    } else {
        if (!isGlobalMsg && msg.recipientId === myUserId) {
            showNotification(msg);
        }
    }
});

function refreshSidebarItem(chatKey) {
    if (chatKey === 'global') {
        const lastMsgEl = globalChatItem.querySelector('.chat-item-last-msg');
        lastMsgEl.textContent = chatsState.global.lastMsg;
        const timeEl = document.getElementById('globalChatTime');
        if (timeEl) timeEl.textContent = chatsState.global.lastTime;
        updateUnreadBadge(globalChatItem, chatsState.global.unread);
        return;
    }

    const item = document.querySelector(`[data-pid="${chatKey}"]`);
    if (item && chatsState[chatKey]) {
        item.querySelector('.chat-item-last-msg').textContent = chatsState[chatKey].lastMsg;
        const timeEl = item.querySelector('.chat-item-time');
        if (timeEl) timeEl.textContent = chatsState[chatKey].lastTime;
        updateUnreadBadge(item, chatsState[chatKey].unread);
    }
}

function updateUnreadBadge(container, count) {
    let badge = container.querySelector('.unread-badge');
    if (count > 0) {
        if (!badge) {
            const footer = container.querySelector('.chat-item-footer') || container.querySelector('.chat-item-info');
            badge = document.createElement('span');
            badge.className = 'unread-badge';
            footer.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : count;
    } else if (badge) {
        badge.remove();
    }
}

function showNotification(msg) {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    
    const name = msg.author || 'Anonim';
    const avatar = msg.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
    const text = msg.type === 'voice' ? '[Ovoz xabari]' : msg.text;

    toast.innerHTML = `
        <img src="${avatar}" class="notification-avatar">
        <div class="notification-content">
            <span class="notification-user">${name}</span>
            <span class="notification-msg">${text}</span>
        </div>
    `;

    toast.onclick = () => {
        switchToPrivateChat({
            persistentId: msg.persistentId,
            customNickname: msg.author,
            avatarUrl: msg.avatarUrl,
            anonId: msg.persistentId.split('-').pop() // Fallback anonId
        });
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    };

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

socket.on('userCount', (n) => {
    if (userCountEl) userCountEl.textContent = `${n} onlayn`;
});

socket.on('messageDeletedLocally', (msgId) => {
    const el = document.querySelector(`[data-id="${msgId}"]`);
    if (el) {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }
    // Update cache
    cachedMessages = cachedMessages.filter(m => m._id != msgId);
    saveCachedMessages(cachedMessages);
});

socket.on('refreshMessages', () => {
    messagesContainer.innerHTML = '';
    localStorage.removeItem(CACHE_KEY);
});

// Theme Management - Premium Light/Dark
const themes = ['light', 'dark'];
let currentThemeIndex = themes.indexOf(localStorage.getItem('chatTheme') || 'light');
if (currentThemeIndex === -1) currentThemeIndex = 0;
document.body.className = `theme-${themes[currentThemeIndex]}`;

themeBtn.addEventListener('click', () => {
    document.body.classList.remove(`theme-${themes[currentThemeIndex]}`);
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    const newTheme = themes[currentThemeIndex];
    document.body.classList.add(`theme-${newTheme}`);
    localStorage.setItem('chatTheme', newTheme);
});

// Settings Handlers
settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
    nicknameInput.value = currentProfile.customNickname || '';
});

closeSettings.addEventListener('click', () => {
    settingsModal.style.display = 'none';
});

window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
    }
});

saveNicknameBtn.addEventListener('click', async () => {
    const newNickname = nicknameInput.value.trim();
    if (newNickname.length < 2) return alert('Nik juda qisqa');
    
    try {
        const res = await fetch('/api/update-nickname', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ persistentId: myUserId, newNickname })
        });
        const data = await res.json();
        if (data.ok) {
            // Socket 'me' event will handle the UI update automatically
            alert("Muvaffaqiyatli o'zgartirildi");
        } else {
            alert(data.error || 'Xatolik');
        }
    } catch (e) {
        alert('Serverga ulanishda xatolik');
    }
});

// Gallery Upload Logic
const selectAvatarOverlay = document.getElementById('selectAvatarOverlay');
const avatarFileInput = document.getElementById('avatarFileInput');
const fileNameDisplay = document.getElementById('fileNameDisplay');

if (selectAvatarOverlay) {
    selectAvatarOverlay.addEventListener('click', () => {
        avatarFileInput.click();
    });
}

avatarFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        return alert("Rasm hajmi 2MB dan kam bo'lishi kerak");
    }

    fileNameDisplay.textContent = `Yuklanmoqda: ${file.name}`;

    const reader = new FileReader();
    reader.onload = async () => {
        const base64 = reader.result;
        try {
            const res = await fetch('/api/update-avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ persistentId: myUserId, base64 })
            });
            const data = await res.json();
            if (data.ok) {
                // Socket 'me' event will handle the UI update
                fileNameDisplay.textContent = 'Muvaffaqiyatli yuklandi';
                setTimeout(() => fileNameDisplay.textContent = '', 3000);
            } else {
                alert(data.error || 'Xatolik');
                fileNameDisplay.textContent = '';
            }
        } catch (err) {
            alert('Yuklashda xatolik');
            fileNameDisplay.textContent = '';
        }
    };
    reader.readAsDataURL(file);
});

// Single point for switching chats, search logic etc.

// Online Users Events - Redirect to Sidebar logic
chatTitle.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
        sidebar.classList.add('open');
    }
});

backBtn.addEventListener('click', () => {
    sidebar.classList.add('open');
});

let lastOnlineUsers = [];
socket.on('onlineUsers', (users) => {
    lastOnlineUsers = users;
    // Sync recentChats cache with latest nicknames/avatars
    users.forEach(u => {
        const idx = recentChats.findIndex(rc => rc.persistentId === u.persistentId);
        if (idx !== -1) {
            recentChats[idx].customNickname = u.customNickname;
            recentChats[idx].avatarUrl = u.avatarUrl;
        }
    });
    localStorage.setItem('recentChats', JSON.stringify(recentChats));
    renderChatList(users);
});

function renderChatList(onlineUsers) {
    chatList.innerHTML = '';
    chatList.appendChild(globalChatItem);

    // Update global chat preview
    const globalLast = globalChatItem.querySelector('.chat-item-last-msg');
    globalLast.textContent = chatsState.global.lastMsg;
    const globalTimeEl = document.getElementById('globalChatTime');
    if (globalTimeEl) globalTimeEl.textContent = chatsState.global.lastTime;
    updateUnreadBadge(globalChatItem, chatsState.global.unread);

    // Combine online users and recent chats for the sidebar
    const displayedPids = new Set();
    
    // 1. First show Online Users (excluding me)
    onlineUsers.forEach(user => {
        if (user.persistentId === myUserId) return;
        renderUserItem(user, true);
        displayedPids.add(user.persistentId);
    });

    // 2. Then show Recent Chats that are offline
    recentChats.forEach(chat => {
        if (!displayedPids.has(chat.persistentId)) {
            renderUserItem(chat, false);
            displayedPids.add(chat.persistentId);
        }
    });
}

function renderUserItem(user, isOnline) {
    const pid = user.persistentId;
    const state = chatsState[pid] || { lastMsg: isOnline ? 'onlayn' : 'oflayn', lastTime: '', unread: 0 };
    
    const div = document.createElement('div');
    div.className = 'chat-item';
    if (currentRecipientId === pid) div.classList.add('active');
    div.setAttribute('data-pid', pid);

    const name = user.customNickname || `Anonim-${user.anonId || pid.split('-').pop()}`;
    const avatar = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;

    div.innerHTML = `
        <img class="chat-item-avatar" src="${avatar}" style="opacity: ${isOnline ? 1 : 0.6}">
        <div class="chat-item-info">
            <div class="chat-item-header">
                <div class="chat-item-name">${name}${isOnline ? '' : ' <small>(oflayn)</small>'}</div>
                <div class="chat-item-time">${state.lastTime}</div>
            </div>
            <div class="chat-item-footer">
                <div class="chat-item-last-msg">${state.lastMsg}</div>
            </div>
        </div>
    `;

    if (state.unread > 0) updateUnreadBadge(div, state.unread);

    div.onclick = () => {
        switchToPrivateChat(user);
        sidebar.classList.remove('open');
        document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
    };

    chatList.appendChild(div);
}

globalChatItem.onclick = () => {
    switchToGlobalChat();
    chatsState.global.unread = 0;
    updateUnreadBadge(globalChatItem, 0);
    sidebar.classList.remove('open');
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    globalChatItem.classList.add('active');
};

// Search logic
chatSearch.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(item => {
        const name = item.querySelector('.chat-item-name').textContent.toLowerCase();
        item.style.display = name.includes(term) ? 'flex' : 'none';
    });
});

async function switchToPrivateChat(user) {
    currentRecipientId = user.persistentId;
    saveRecentChat(user);
    renderChatList(lastOnlineUsers); // Refresh sidebar to show recent chat if it was hidden
    
    // Reset unread count for this user
    if (chatsState[currentRecipientId]) {
        chatsState[currentRecipientId].unread = 0;
        refreshSidebarItem(currentRecipientId);
    }

    let name = user.customNickname || (user.anonId ? `Anonim-${user.anonId}` : 'Anonim');
    
    // If we only have persistentId (e.g. from avatar click in global), try to fetch full details
    if (!user.customNickname && !user.anonId) {
        try {
            const res = await fetch(`/api/user/${user.persistentId}`);
            const data = await res.json();
            if (!data.error) {
                name = data.customNickname || `Anonim-${data.anonId}`;
            }
        } catch (e) {}
    }

    chatTitle.textContent = name;
    const existingStatus = document.getElementById('chatStatus');
    if (existingStatus) existingStatus.remove();
    chatTitle.insertAdjacentHTML('afterend', '<div id="chatStatus" class="chat-status">Lichka</div>');
    backBtn.style.display = 'block';
    messagesContainer.innerHTML = '<div class="hint">Lichka yuklanmoqda...</div>';
    socket.emit('loadPrivateMessages', currentRecipientId);
}

function switchToGlobalChat() {
    currentRecipientId = null;
    chatTitle.textContent = 'Anonim Chat';
    const status = document.getElementById('chatStatus');
    if (status) status.remove();
    backBtn.style.display = 'none';
    messagesContainer.innerHTML = '<div class="hint">Global chat yuklanmoqda...</div>';
    socket.emit('setUserId', myUserId);
}

// Clear Cache
clearCacheBtn.addEventListener('click', () => {
    localStorage.removeItem(CACHE_KEY);
    messagesContainer.innerHTML = '';
    alert('Kesh tozalandi');
});

// Reply Logic
let replyToId = null;
function setReply(msg) {
    replyToId = msg._id;
    replyUserEl.textContent = msg.author || 'Anonim';
    const previewContent = msg.text || (msg.type === 'voice' ? '[Ovoz xabari]' : msg.type === 'sticker' ? '[Stiker]' : 'Xabar');
    replyTextEl.textContent = previewContent;
    replyPreviewEl.style.display = 'flex';
    messageInput.focus();
}

cancelReplyBtn.addEventListener('click', () => {
    replyToId = null;
    replyPreviewEl.style.display = 'none';
});

// Auto-resize textarea
messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = (messageInput.scrollHeight) + 'px';

    // Toggle Send/Voice button
    if (messageInput.value.trim().length > 0) {
        sendBtn.style.display = 'flex';
        voiceBtn.style.display = 'none';
    } else {
        sendBtn.style.display = 'none';
        voiceBtn.style.display = 'flex';
    }
});

// Voice Recording Logic
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordStartTime = null;
let recordTimer = null;

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            if (audioChunks.length > 0 && !cancelScheduled) {
                sendVoiceMessage(audioBlob);
            }
            audioChunks = [];
        };

        mediaRecorder.start();
        isRecording = true;
        recordStartTime = Date.now();
        voiceBtn.classList.add('recording');
        recordingIndicator.style.display = 'flex';

        recordTimer = setInterval(() => {
            const sec = Math.floor((Date.now() - recordStartTime) / 1000);
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            recordingTime.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
        }, 1000);
    } catch (e) {
        alert('Mikrofonga ruxsat berilmagan');
    }
}

let cancelScheduled = false;
function stopRecording(cancel = false) {
    if (!isRecording) return;
    cancelScheduled = cancel;
    isRecording = false;
    clearInterval(recordTimer);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    voiceBtn.classList.remove('recording');
    recordingIndicator.style.display = 'none';
    recordingTime.textContent = '0:00';
}

voiceBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording(false);
    }
});

cancelRecordBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopRecording(true);
});

// Message Sending
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const payload = { type: 'text', text };
    if (replyToId) payload.replyTo = replyToId;
    if (currentRecipientId) payload.recipientId = currentRecipientId;

    socket.emit('sendMessage', payload);

    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.style.display = 'none';
    voiceBtn.style.display = 'flex';

    replyToId = null;
    replyPreviewEl.style.display = 'none';
}

async function sendVoiceMessage(blob) {
    const reader = new FileReader();
    reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        const payload = {
            type: 'voice',
            audio: base64,
            duration: Math.floor((Date.now() - recordStartTime) / 1000)
        };
        if (replyToId) payload.replyTo = replyToId;
        if (currentRecipientId) payload.recipientId = currentRecipientId;
        socket.emit('sendMessage', payload);

        replyToId = null;
        replyPreviewEl.style.display = 'none';
    };
    reader.readAsDataURL(blob);
}

function sendSticker(url) {
    const payload = { type: 'sticker', stickerUrl: url };
    if (replyToId) payload.replyTo = replyToId;
    if (currentRecipientId) payload.recipientId = currentRecipientId;
    socket.emit('sendMessage', payload);
    
    replyToId = null;
    replyPreviewEl.style.display = 'none';
}

sendBtn.addEventListener('click', (e) => {
    e.preventDefault();
    sendMessage();
});
messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// UI Helpers
function addMessage(msg, scroll = true) {
    const { text, author, avatarUrl, type, audio, audioData, duration, replyTo, replyAuthor, replyText, persistentId, socketId, _id, stickerUrl, imageUrl, fileUrl, fileData, fileName, fileSize } = msg;

    const div = document.createElement('div');
    div.className = 'message';
    div.id = _id;
    if (type === 'sticker') div.classList.add('sticker');
    const isMine = (persistentId && persistentId === myUserId) || (socketId === mySocketId);
    if (isMine) div.classList.add('mine');

    const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Avatar
    const authorName = author || 'A';
    const bgHex = getAvatarColor(persistentId || socketId || authorName);
    const avatarSrc = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}&background=${bgHex}&color=fff`;
    
    const avatarHtml = `<img class="msg-avatar" src="${avatarSrc}" alt="Avatar" onclick="event.stopPropagation(); switchToPrivateChat({persistentId: '${persistentId}'})">`;
    
    let inner = `
        <div class="message-content-wrapper">
            ${persistentId ? avatarHtml : `<img class="msg-avatar" src="${avatarSrc}" alt="Avatar">`}
            <div class="message-bubble-content">
                <span class="meta">${author || 'Anonim'} • ${time}</span>
    `;

    if (replyTo) {
        inner += `
            <div class="reply-quote" onclick="const el=document.getElementById('${replyTo}'); if(el) el.scrollIntoView({behavior:'smooth', block:'center'})">
                <strong>${replyAuthor || 'Anonim'}</strong>
                <div class="reply-quote-text">${(replyText || '').slice(0, 80)}</div>
            </div>
        `;
    }

    if (type === 'voice') {
        const dur = duration ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : '0:00';
        const src = audioData || audio;
        const voiceUrl = (src && src.startsWith('data:')) ? src : `data:audio/webm;base64,${src}`;
        inner += `
            <div class="voice-message-bubble">
                <button class="voice-play-btn">▶</button>
                <div class="voice-waves-container">
                    ${Array.from({length: 20}).map(() => '<div class="voice-wave"></div>').join('')}
                </div>
                <span class="voice-duration">${dur}</span>
                <audio src="${voiceUrl}"></audio>
            </div>
        `;
    } else if (type === 'sticker') {
        inner += `<img src="${stickerUrl}" class="sticker-img" alt="Sticker">`;
    } else if (type === 'image') {
        const src = fileData || imageUrl;
        const imgUrl = (src && src.startsWith('data:')) ? src : `data:image/jpeg;base64,${src}`;
        inner += `<img src="${imgUrl}" class="attachment-img" alt="Rasm" onclick="openLightbox('${imgUrl}')">`;
    } else if (type === 'file') {
        const src = fileData || fileUrl;
        const downloadUrl = (src && src.startsWith('data:')) ? src : `data:application/octet-stream;base64,${src}`;
        inner += `
            <a href="${downloadUrl}" download="${fileName || 'file'}" class="file-bubble">
                <span class="file-icon">📁</span>
                <div class="file-info">
                    <span class="file-name">${fileName || 'Fayl'}</span>
                    <span class="file-size">${fileSize || ''}</span>
                </div>
            </a>
        `;
    } else {
        inner += `<div class="body">${escapeHtml(text || '')}</div>`;
    }

    inner += `
            </div>
        </div>
    `;

    div.innerHTML = inner;
    div.setAttribute('data-id', _id);

    // Delete for me button
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-delete-btn';
    delBtn.innerHTML = '×';
    delBtn.title = 'Faqat o\'zim uchun o\'chirish';
    delBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm('Ushbu xabarni faqat o\'zingiz uchun o\'chirasizmi?')) {
            socket.emit('deleteForMe', _id);
        }
    };
    div.appendChild(delBtn);

    div.onclick = () => setReply(msg);

    // Voice player logic
    if (type === 'voice') {
        const playBtn = div.querySelector('.voice-play-btn');
        const audioEl = div.querySelector('audio');
        playBtn.onclick = (e) => {
            e.stopPropagation();
            if (audioEl.paused) {
                audioEl.play();
                playBtn.textContent = '⏸';
            } else {
                audioEl.pause();
                playBtn.textContent = '▶';
            }
        };
        audioEl.onended = () => playBtn.textContent = '▶';
    }

    messagesContainer.appendChild(div);
    if (scroll) scrollToBottom();
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Phase 10 & 11: Hamburger Menu and Lightbox Logic
if (hamburgerBtn && navDrawer && navDrawerOverlay) {
    const toggleDrawer = () => {
        const isClosed = navDrawer.style.transform === 'translateX(-100%)';
        if (isClosed) {
            navDrawerOverlay.style.display = 'block';
            setTimeout(() => {
                navDrawer.style.transform = 'translateX(0)';
                navDrawerOverlay.style.opacity = '1';
            }, 10);
        } else {
            navDrawer.style.transform = 'translateX(-100%)';
            navDrawerOverlay.style.opacity = '0';
            setTimeout(() => navDrawerOverlay.style.display = 'none', 300);
        }
    };

    hamburgerBtn.addEventListener('click', toggleDrawer);
    navDrawerOverlay.addEventListener('click', toggleDrawer);

    if (drawerProfileBtn) {
        drawerProfileBtn.addEventListener('click', () => {
            toggleDrawer();
            settingsModal.style.display = 'flex';
            nicknameInput.value = currentProfile.customNickname || '';
        });
    }

    if (drawerThemeBtn) {
        drawerThemeBtn.addEventListener('click', () => {
            toggleDrawer();
            themeBtn.click(); // Reuse existing logic
        });
    }
    
    if (drawerCacheBtn) {
        drawerCacheBtn.addEventListener('click', () => {
            toggleDrawer();
            clearCacheBtn.click(); // Reuse existing logic
        });
    }
}

// Lightbox
window.openLightbox = function(url) {
    if (!lightboxOverlay || !lightboxImage || !downloadLightbox) return;
    lightboxImage.src = url;
    downloadLightbox.href = url;
    lightboxOverlay.style.display = 'flex';
};

if (closeLightbox && lightboxOverlay) {
    closeLightbox.addEventListener('click', () => {
        lightboxOverlay.style.display = 'none';
        lightboxImage.src = '';
    });
    
    lightboxOverlay.addEventListener('click', (e) => {
        if (e.target === lightboxOverlay) {
            lightboxOverlay.style.display = 'none';
            lightboxImage.src = '';
        }
    });
}
