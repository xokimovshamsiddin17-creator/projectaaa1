const socket = io();

// Generate or retrieve persistent user ID
let myUserId = localStorage.getItem('chatUserId');
if (!myUserId) {
    myUserId = 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('chatUserId', myUserId);
}

let mySocketId = null;
socket.on('connect', () => {
    mySocketId = socket.id;
    socket.emit('setUserId', myUserId);
});

// UI Elements
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const voiceBtn = document.getElementById('voiceBtn');
const recordingIndicator = document.getElementById('recording-indicator');
const recordingTime = document.getElementById('recording-time');
const themeBtn = document.getElementById('themeBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const userCountEl = document.getElementById('userCount');
const replyPreviewEl = document.getElementById('replyPreview');
const replyInfoEl = document.getElementById('replyInfo');
const cancelReplyBtn = document.getElementById('cancelReply');
const cancelRecordBtn = document.getElementById('cancelRecordBtn');


// Message cache
const CACHE_KEY = 'chatMessages_v2';
let cachedMessages = [];

function saveCachedMessages(arr) {
    try {
        cachedMessages = (arr || []).slice(-100);
        localStorage.setItem(CACHE_KEY, JSON.stringify(cachedMessages));
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

loadCachedMessages();

// Socket Events
socket.on('initMessages', (msgs) => {
    messagesContainer.innerHTML = '';
    msgs.forEach(msg => addMessage(msg, false));
    saveCachedMessages(msgs);
    scrollToBottom();
});

socket.on('newMessage', (msg) => {
    addMessage(msg, true);
    cachedMessages.push(msg);
    saveCachedMessages(cachedMessages);
});

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

// Theme Management
const themes = ['light', 'dark', 'blue', 'green', 'purple'];
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

// Clear Cache
clearCacheBtn.addEventListener('click', () => {
    localStorage.removeItem(CACHE_KEY);
    messagesContainer.innerHTML = '';
    alert('Kesh tozalandi');
});

// Clear All (Admin/Global)
clearAllBtn.addEventListener('click', async () => {
    if (confirm('Barcha xabarlar o\'chirilsinmi?')) {
        await fetch('/clear');
    }
});

// Reply Logic
let replyToId = null;
function setReply(msg) {
    replyToId = msg._id;
    replyInfoEl.textContent = `Javob: ${msg.author}: ${msg.text || '[Ovoz xabari]'}`;
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

voiceBtn.addEventListener('click', () => {
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
        socket.emit('sendMessage', payload);

        replyToId = null;
        replyPreviewEl.style.display = 'none';
    };
    reader.readAsDataURL(blob);
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// UI Helpers
function addMessage(msg, scroll = true) {
    const { text, author, type, audio, duration, replyTo, replyAuthor, replyText, persistentId, socketId, _id } = msg;

    const div = document.createElement('div');
    div.className = 'message';
    if ((persistentId && persistentId === myUserId) || (socketId === mySocketId)) {
        div.classList.add('mine');
    }

    const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let inner = `<span class="meta">${author || 'Anonim'} • ${time}</span>`;

    if (replyTo) {
        inner += `<div class="reply-quote"><strong>${replyAuthor || 'Anonim'}</strong>: ${(replyText || '').slice(0, 50)}...</div>`;
    }

    if (type === 'voice') {
        const dur = duration ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : '0:00';
        inner += `
            <div class="voice-message-bubble">
                <button class="voice-play-btn">▶</button>
                <span class="voice-duration">${dur}</span>
                <audio src="data:audio/webm;base64,${audio}"></audio>
            </div>
        `;
    } else {
        inner += `<div class="body">${escapeHtml(text)}</div>`;
    }

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

