const socket = io();

console.log('Socket.io client loaded');

// Generate or retrieve persistent user ID from localStorage
let myUserId = localStorage.getItem('chatUserId');
if (!myUserId) {
    myUserId = 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('chatUserId', myUserId);
}

console.log('Mening user ID:', myUserId);

// Store socket ID for server communication
let mySocketId = null;
socket.on('connect', () => {
    mySocketId = socket.id;
    // Send user ID to server
    socket.emit('setUserId', myUserId);
    console.log('Socket ulanish muvaffaq, ID:', mySocketId);
});

// Handle initial messages
socket.on('initMessages', (msgs) => {
    console.log('Awal xabarlar keldi, soni:', msgs.length);
    // replace cached UI with authoritative server list
    messagesContainer.innerHTML = '';
    msgs.forEach(msg => addMessage(msg));
    // persist server-sent messages to local cache for future refreshes
    try { saveCachedMessages(msgs); } catch (e) { console.warn('Saving init messages to cache failed', e); }
});

// New message from server
socket.on('newMessage', (msg) => {
    console.log('Yangi xabar keldi:', msg);
    addMessage(msg);
    try {
        // append to cache and keep size bounded
        cachedMessages.push(msg);
        saveCachedMessages(cachedMessages);
    } catch (e) { console.warn('Updating cache with new message failed', e); }
});

const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const voiceBtn = document.getElementById('voiceBtn');
const recordingIndicator = document.getElementById('recording-indicator');
const recordingTime = document.getElementById('recording-time');
const themeBtn = document.getElementById('themeBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');

// Message cache (localStorage) — improves refresh UX
const CACHE_KEY = 'chatMessages_v1';
let cachedMessages = [];
function saveCachedMessages(arr) {
    try {
        cachedMessages = (arr || []).slice(-200);
        localStorage.setItem(CACHE_KEY, JSON.stringify(cachedMessages));
    } catch (e) { console.warn('Cache save failed', e); }
}
function loadCachedMessages() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) return;
        cachedMessages = parsed;
        // render cached messages immediately for snappy UX
        messagesContainer.innerHTML = '';
        cachedMessages.forEach(msg => addMessage(msg));
        console.log('Cached messages restored:', cachedMessages.length);
    } catch (e) {
        console.warn('Cache load failed', e);
    }
}

// restore cached messages before socket sync
loadCachedMessages();

// Initially disable send button
sendBtn.disabled = true;

// Theme management
const themes = ['light', 'dark', 'blue', 'green', 'purple'];
let currentThimeIndex = 0;

// Load saved theme
const savedTheme = localStorage.getItem('chatTheme') || 'light';
currentThimeIndex = themes.indexOf(savedTheme);
document.body.classList.add(`theme-${savedTheme}`);

// Theme button handler
if (themeBtn) {
    themeBtn.addEventListener('click', () => {
        // Remove current theme
        document.body.classList.remove(`theme-${themes[currentThimeIndex]}`);
        
        // Move to next theme
        currentThimeIndex = (currentThimeIndex + 1) % themes.length;
        const newTheme = themes[currentThimeIndex];
        
        // Add new theme
        document.body.classList.add(`theme-${newTheme}`);
        
        // Save to localStorage
        localStorage.setItem('chatTheme', newTheme);
        
        console.log('Tema o\'zgartirildi:', newTheme);
    });
}

// Clear local cache button (UI-only) — removes cached messages stored locally
if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', () => {
        localStorage.removeItem(CACHE_KEY);
        cachedMessages = [];
        messagesContainer.innerHTML = '';
        alert('Mahalliy kesh tozalandi');
    });
}

// Clear for everyone (calls server /clear) — VISIBLE TO ALL (with confirmation)
const clearAllBtn = document.getElementById('clearAllBtn');
if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
        const ok = confirm('Hamma mijozlardan xabarlar o\'chiriladi. Davom etilsinmi?');
        if (!ok) return;
        clearAllBtn.disabled = true;
        try {
            const res = await fetch('/clear');
            const data = await res.json();
            alert(data.msg || 'Barcha xabarlar o\'chirildi');
        } catch (err) {
            console.error('Clear for everyone failed', err);
            alert('Xato: serverga ulanish mumkin emas');
        } finally {
            clearAllBtn.disabled = false;
        }
    });
}

// Voice recording state
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
let isRecording = false;
let recordedAudio = null;
let recordedAudioBlob = null;

// Initialize voice recording
async function initVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.addEventListener('dataavailable', (event) => {
            audioChunks.push(event.data);
        });
        
        mediaRecorder.addEventListener('stop', () => {
            recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            showVoicePreview(recordedAudioBlob);
            audioChunks = [];
        });
    } catch (err) {
        console.error('Ovozni yozib olishda muammo:', err);
        alert('Ovozni yozib olish uchun huquq berilmadi');
    }
}

// Show voice preview in input area
function showVoicePreview(audioBlob) {
    const reader = new FileReader();
    reader.onload = () => {
        const base64Audio = reader.result.split(',')[1];
        recordedAudio = base64Audio;
        
        // Hide textarea and show audio player
        messageInput.style.display = 'none';
        waveformEl.style.display = 'none';
        
        // Create audio preview element
        if (!document.getElementById('voicePreview')) {
            const previewDiv = document.createElement('div');
            previewDiv.id = 'voicePreview';
            
            const audioEl = document.createElement('audio');
            audioEl.controls = true;
            audioEl.style.cssText = 'flex: 1; height: 44px;';
            audioEl.src = reader.result;
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '✕';
            cancelBtn.style.cssText = 'padding: 8px 12px; background: #fff; border: 1px solid #0d47a1; border-radius: 8px; cursor: pointer; color: #0d47a1; font-weight: 600;';
            cancelBtn.onclick = cancelVoicePreview;
            
            previewDiv.appendChild(audioEl);
            previewDiv.appendChild(cancelBtn);
            
            messageInput.parentElement.insertBefore(previewDiv, messageInput);
        } else {
            document.getElementById('voicePreview').style.display = 'flex';
            document.querySelector('#voicePreview audio').src = reader.result;
        }
        
        // Enable send button
        sendBtn.disabled = false;
    };
    reader.readAsDataURL(audioBlob);
}

function cancelVoicePreview() {
    const previewEl = document.getElementById('voicePreview');
    if (previewEl) {
        previewEl.style.display = 'none';
    }
    messageInput.style.display = 'block';
    waveformEl.style.display = 'none';
    recordedAudio = null;
    recordedAudioBlob = null;
    sendBtn.disabled = true;
}

const waveformEl = document.getElementById('waveform');

// Voice recording: single-tap toggles start/stop (more intuitive)
async function startRecording() {
    if (!mediaRecorder) await initVoiceRecording();
    if (isRecording) return;

    isRecording = true;
    audioChunks = [];
    recordingStartTime = Date.now();
    voiceBtn.classList.add('recording');
    recordingIndicator.style.display = 'flex';
    waveformEl.style.display = 'flex';
    messagesContainer.classList.add('recording');
    messageInput.disabled = true;
    sendBtn.disabled = true;
    mediaRecorder.start();

    recordingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        recordingTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        if (elapsed >= 60) stopRecording();
    }, 100);
}

// Toggle on click/tap — start if stopped, stop if recording
voiceBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!isRecording) {
        await startRecording();
    } else {
        stopRecording();
    }
});

// Also keep keyboard accessibility: space/enter toggles recording when focused
voiceBtn.addEventListener('keydown', async (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!isRecording) await startRecording(); else stopRecording();
    }
});


function stopRecording() {
    isRecording = false;
    voiceBtn.classList.remove('recording');
    recordingIndicator.style.display = 'none';
    waveformEl.style.display = 'none';
    messagesContainer.classList.remove('recording');
    messageInput.disabled = false;
    
    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

function updateSendButtonState() {
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.disabled = !hasText && !isRecording;
}

// Update send button state as user types
messageInput.addEventListener('input', updateSendButtonState);

// Send voice message
function sendVoiceMessage(audioBlob) {
    // This is now handled in sendMessage function
}

// Rate limiting state
let cooldownActive = false;
let cooldownRemaining = 0;

// Debug: Log socket connection events
socket.on('connect', () => {
    console.log('Socket ulandi, ID:', socket.id);
});

socket.on('disconnect', () => {
    console.log('Socket uzildi');
});

socket.on('connect_error', (err) => {
    console.error('Socket ulanmadi:', err);
});

// Handle rate limit cooldown
socket.on('cooldown', (data) => {
    console.log('Kutish rejimi:', data.remainingTime, 'soniya');
    cooldownActive = true;
    cooldownRemaining = data.remainingTime;
    sendBtn.disabled = true;
    sendBtn.textContent = `Kutmoq... ${cooldownRemaining}s`;
    
    const cooldownInterval = setInterval(() => {
        cooldownRemaining--;
        if (cooldownRemaining <= 0) {
            clearInterval(cooldownInterval);
            cooldownActive = false;
            sendBtn.disabled = false;
            sendBtn.textContent = 'Yuborish';
            console.log('Kutish vaqti tugadi, habar yubora olasiz');
        } else {
            sendBtn.textContent = `Kutmoq... ${cooldownRemaining}s`;
        }
    }, 1000);
});

// Update online user count UI
const userCountEl = document.getElementById('userCount');
socket.on('userCount', (n) => {
    console.log('Online count updated:', n);
    if (userCountEl) userCountEl.textContent = `${n} onlayn`;
});

// Handle message refresh (when admin clears messages)
socket.on('refreshMessages', () => {
    console.log('Messages cleared by admin');
    messagesContainer.innerHTML = '';
});

// store this client's anon identity (server sends on connect)
let myAnon = null;
let myAuthor = null;
socket.on('me', (data) => {
    if (data && data.anonId) {
        myAnon = data.anonId;
        myAuthor = `Anonim-${myAnon}`;
        console.log('Mening anon id:', myAuthor);
    }
});

// Reply state
let replyToId = null;
const replyPreviewEl = document.getElementById('replyPreview');
const replyInfoEl = document.getElementById('replyInfo');
const cancelReplyBtn = document.getElementById('cancelReply');
if (cancelReplyBtn) cancelReplyBtn.addEventListener('click', () => {
    replyToId = null;
    if (replyPreviewEl) replyPreviewEl.setAttribute('aria-hidden', 'true');
});

// Render a single message into the messages container
function addMessage(msg) {
    const { text, author = 'Anonim', createdAt, type = 'text', sticker, audio, duration, _id, replyTo, replyAuthor, replyText, socketId } = msg;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    if (_id) messageDiv.dataset.id = String(_id);

    const time = createdAt ? new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    // build inner HTML with optional reply quote
    let replyHtml = '';
    if (replyTo && (replyAuthor || replyText)) {
        replyHtml = `<div class="reply-quote"><strong>${escapeHtml(replyAuthor || 'Anonim')}</strong>: ${escapeHtml((replyText||'').slice(0,120))}</div>`;
    }

    if (type === 'voice') {
        const durationStr = duration ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : '0:00';
        messageDiv.innerHTML = `
            <span class="meta">${author} • ${time}</span>
            ${replyHtml}
            <div class="voice-message-bubble">
                <button class="voice-play-btn" data-audio="data:audio/webm;base64,${audio}">▶️</button>
                <span class="voice-duration">${durationStr}</span>
                <audio></audio>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <span class="meta">${author} • ${time}</span>
            ${replyHtml}
            <div class="body">${escapeHtml(text)}</div>
        `;
    }

    // mark as 'mine' locally when the message belongs to this client
    // Prefer persistentId (survives refresh) and fall back to socketId
    if ((msg.persistentId && myUserId && msg.persistentId === myUserId) || (mySocketId && socketId === mySocketId)) {
        messageDiv.classList.add('mine');
    }

    // Add voice play button listener
    const voicePlayBtn = messageDiv.querySelector('.voice-play-btn');
    if (voicePlayBtn) {
        voicePlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const audioData = voicePlayBtn.dataset.audio;
            const audioEl = messageDiv.querySelector('audio');
            
            if (audioEl.src !== audioData) {
                audioEl.src = audioData;
            }
            
            if (audioEl.paused) {
                audioEl.play();
                voicePlayBtn.textContent = '⏸️';
            } else {
                audioEl.pause();
                voicePlayBtn.textContent = '▶️';
            }
        });
        
        const audioEl = messageDiv.querySelector('audio');
        audioEl.addEventListener('ended', () => {
            voicePlayBtn.textContent = '▶️';
        });
    }

    // click to reply: set reply state for this message
    messageDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('voice-play-btn')) return; // Don't reply on button click
        e.stopPropagation();
        // set reply state
        replyToId = _id || null;
        if (replyPreviewEl && replyInfoEl) {
            const excerpt = replyText || (type === 'voice' ? '[Ovoz xabari]' : (text || ''));
            replyInfoEl.textContent = `Javob: ${author}: "${(excerpt||'').slice(0,80)}"`;
            replyPreviewEl.setAttribute('aria-hidden', 'false');
        }
    });

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Escape text to avoid HTML injection
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Send message to server
function sendMessage() {
    // Check if voice message
    if (recordedAudio) {
        const duration = recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0;
        const payload = { 
            type: 'voice', 
            audio: recordedAudio,
            duration: duration
        };
        if (replyToId) payload.replyTo = replyToId;
        socket.emit('sendMessage', payload);
        console.log('Ovoz xabari yuborildi');
        
        // Clear recorded audio
        cancelVoicePreview();
        recordedAudio = null;
        recordedAudioBlob = null;
        
        // Clear reply state
        replyToId = null;
        if (replyPreviewEl) replyPreviewEl.setAttribute('aria-hidden', 'true');
        return;
    }
    
    const text = messageInput.value.trim();
    console.log('Sending message:', text);
    
    // Check if in cooldown
    if (cooldownActive) {
        console.warn('Hozir xabar yubora olmaysiz, kutish rejimida');
        return;
    }
    
    if (!text) {
        console.warn('Matn bo\'sh');
        return;
    }
    const payload = { type: 'text', text };
    if (replyToId) payload.replyTo = replyToId;
    socket.emit('sendMessage', payload);
    console.log('Xabar emit qilindi');
    messageInput.value = '';
    messageInput.focus();
    // clear reply state
    replyToId = null;
    if (replyPreviewEl) replyPreviewEl.setAttribute('aria-hidden', 'true');
    
    // Update send button state
    updateSendButtonState();
}

sendBtn.addEventListener('click', sendMessage);

// Enter to send (Shift+Enter for newline)
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
