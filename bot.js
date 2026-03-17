const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const db = require('./db.js');
const User = db.Users;

const token = process.env.BOT_TOKEN;
const adminId = process.env.ADMIN_ID;

if (!token) {
    console.error('ERROR: BOT_TOKEN topilmadi! .env faylini tekshiring.');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Handle polling errors gracefully
bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
        // Silently log 409 conflict to avoid noisy logs (usually means another instance is running)
        // console.log('Bot polling conflict (409). Check if another bot instance is running.');
    } else {
        console.error('Bot polling error:', error.code, error.message);
    }
});

// App Settings (can be modified by Admin)
let settings = {
};

// Start logic
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    try {
        let user = User.findOne({ persistentId: telegramId });

        if (!user) {
            const count = User.countDocuments();
            user = {
                persistentId: telegramId,
                anonId: 1000 + count,
                createdAt: new Date().toISOString()
            };
            User.save(user);
        }

        const options = {
            reply_markup: {
                keyboard: [
                    [{ text: "📞 Kontakt yuborish", request_contact: true }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };

        bot.sendMessage(chatId, `Assalomu alaykum! Sizning doimiy anonim raqamingiz: ${user.anonId}\n\nBu raqam o'zgarmasdir va sizni guruhda yoki botda tanishlari uchun xizmat qiladi.\n\n👇 Iltimos, kontakt tugmasini bosib raqamingizni tasdiqlang.`, options);
        // Admin commands
        if (telegramId === adminId) {
            sendAdminMenu(chatId);
        }
    } catch (err) {
        console.error('Bot /start error:', err);
        bot.sendMessage(chatId, "Xatolik yuz berdi. Iltimos keyinroq urinib ko'ring.");
    }
});

function sendAdminMenu(chatId) {
    const menu = {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: `Xabarlar tozalash funksiyasi olib tashlandi`,
                        callback_data: 'none'
                    }
                ]
            ]
        }
    };
    bot.sendMessage(chatId, "Admin Panel:", menu);
}

// Nickname change command
bot.onText(/\/nickname (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);
    const newNickname = match[1].trim();

    if (newNickname.length < 2 || newNickname.length > 20) {
        return bot.sendMessage(chatId, "Nik 2 tadan 20 tagacha belgidan iborat bo'lishi kerak.");
    }

    try {
        let user = User.findOne({ persistentId: telegramId });
        if (!user) {
            const count = User.countDocuments();
            user = { persistentId: telegramId, anonId: 1000 + count, createdAt: new Date().toISOString() };
        }

        const now = new Date();
        if (user.lastNicknameChange) {
            const lastChange = new Date(user.lastNicknameChange);
            const diffDays = (now - lastChange) / (1000 * 60 * 60 * 24);
            if (diffDays < 14) {
                const waitDays = Math.ceil(14 - diffDays);
                return bot.sendMessage(chatId, `Nikni faqat 2 haftada bir marta o'zgartirish mumkin. Iltimos, yana ${waitDays} kun kuting.`);
            }
        }

        user.customNickname = newNickname;
        user.lastNicknameChange = now.toISOString();
        User.save(user);

        bot.sendMessage(chatId, `Sizning nikingiz muvaffaqiyatli "${newNickname}" ga o'zgartirildi!`);
    } catch (err) {
        console.error('Bot /nickname error:', err);
        bot.sendMessage(chatId, "Xatolik yuz berdi.");
    }
});

// Avatar update via photo
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    try {
        const photo = msg.photo[msg.photo.length - 1]; // Get highest resolution
        const file = await bot.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

        let user = User.findOne({ persistentId: telegramId });
        if (!user) {
            const count = User.countDocuments();
            user = { persistentId: telegramId, anonId: 1000 + count, createdAt: new Date().toISOString() };
        }

        user.avatarUrl = fileUrl; // In a production app, we'd download and host this locally
        User.save(user);

        bot.sendMessage(chatId, "Profilingiz rasmi muvaffaqiyatli yangilandi!");
    } catch (err) {
        console.error('Bot photo error:', err);
        bot.sendMessage(chatId, "Rasmni saqlashda xatolik yuz berdi.");
    }
});

bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    if (msg.contact && String(msg.contact.user_id) === telegramId) {
        let user = User.findOne({ persistentId: telegramId });
        if (user) {
            user.phone = msg.contact.phone_number;
            user.firstName = msg.contact.first_name;
            User.save(user);

            // Remove keyboard after successful contact share
            bot.sendMessage(chatId, "✅ Kontakt muvaffaqiyatli qabul qilindi. Rahmat!", {
                reply_markup: {
                    remove_keyboard: true
                }
            });
        }
    } else {
        bot.sendMessage(chatId, "Iltimos, faqat o'zingizning kontaktingizni yuboring.");
    }
});

async function sendReplyNotification(targetPid, senderName) {
    try {
        const user = User.findOne({ persistentId: String(targetPid) });
        if (user && user.persistentId) {
            bot.sendMessage(user.persistentId, `🔔 Sizning xabaringizga "${senderName}" javob yozdi!`);
        }
    } catch (e) {
        console.error('Error sending reply notification:', e);
    }
}

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const telegramId = String(query.from.id);

    if (telegramId !== adminId) return;

    if (query.data === 'toggle_clearing') {
        bot.answerCallbackQuery(query.id, { text: "Bu funksiya o'chirib tashlangan." });
    }
});

module.exports = {
    bot,
    getSettings: () => settings,
    sendReplyNotification
};
