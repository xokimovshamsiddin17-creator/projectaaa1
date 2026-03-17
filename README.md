# Anonim yozish — real-time anonim chat

Bu loyiha oddiy anonim yozish servisini yaratadi: frontend — HTML/CSS/JS, backend — Node.js + Express + Socket.io, va MongoDB xabarlarni saqlash uchun.

Quick start:

1. MongoDB ni ishga tushiring (mahalliy yoki MongoDB Atlas). Agar mahalliy bo'lsa, odatda:

```powershell
mongod --dbpath C:\data\db
```

2. Dependencies o'rnating:

```bash
npm install
```

3. Agar kerak bo'lsa, `MONGODB_URI` atrof-muhit o'zgaruvchisiga MongoDB URL qo'ying. Migratsiya uchun default lokal `mongodb://127.0.0.1:27017/anonim` ishlatiladi.

Windows PowerShell misollari:

```powershell
$env:MONGODB_URI = "your_mongo_uri_here"
npm start
```

4. Brauzerda oching: http://localhost:3000

Foydalanish: matn yozib "Yuborish" tugmasini bosing. Xabarlar real-time ko'rinadi va MongoDB ga saqlanadi.
