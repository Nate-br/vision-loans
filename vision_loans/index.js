const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('8382406212:AAHHMBzcwYiqLhltPErmrt4yCNE-TZnOp1o');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI);

const UserSchema = new mongoose.Schema({
  phone: { type: String, unique: true, required: true },
  telegramId: String,
  chatId: String,
  name: String,
  gender: String, // M or F
  church: String,
  pin: String, // Hashed 4-digit PIN
  otp: String,
  otpExpiry: Date,
  isRegistered: { type: Boolean, default: false }
});

const User = mongoose.model('User', UserSchema);

// Initialize Bot
const bot = new TelegramBot(process.env.BOT_TOKEN);

// --- TELEGRAM BOT LOGIC ---
app.post('/api/webhook', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  if (text === '/start') {
    await bot.sendMessage(chatId, "Welcome to Vision Loans! To sign up, please share your contact number using the button below.", {
      reply_markup: {
        keyboard: [[{ text: "Share Contact", request_contact: true }]],
        one_time_keyboard: true
      }
    });
  } else if (message.contact) {
    const phone = message.contact.phone_number.replace('+', '');
    // Security: Ensure contact belongs to sender
    if (message.contact.user_id !== message.from.id) {
      return bot.sendMessage(chatId, "Please share your OWN contact number.");
    }

    await User.findOneAndUpdate(
      { phone },
      { telegramId: message.from.id, chatId, isRegistered: true },
      { upsert: true }
    );

    await bot.sendMessage(chatId, "Contact verified! What is your Full Name?");
    // Note: In a real bot, you'd use a state machine/session to track Name -> Gender -> Church
    // For brevity here, we assume the backend handles state.
  }
  res.sendStatus(200);
});

// --- MOBILE APP API ---

// 1. Check if user exists & Send OTP
app.post('/api/auth/check-phone', async (req, res) => {
  const { phone } = req.body; // e.g. 251911...
  const user = await User.findOne({ phone, isRegistered: true });

  if (!user) return res.status(404).json({ message: "User not found. Register on Telegram Bot first." });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.otp = otp;
  user.otpExpiry = new Date(Date.now() + 5 * 60000); // 5 mins
  await user.save();

  await bot.sendMessage(user.chatId, `Your Vision Loans login code is: ${otp}`);
  res.json({ message: "OTP sent to your Telegram bot." });
});

// 2. Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  const user = await User.findOne({ phone, otp, otpExpiry: { $gt: new Date() } });

  if (!user) return res.status(400).json({ message: "Invalid or expired OTP." });

  user.otp = null; // Clear OTP
  await user.save();
  res.json({ message: "Verified", needsPin: !user.pin });
});

// 3. Set/Check PIN
app.post('/api/auth/login-pin', async (req, res) => {
  const { phone, pin } = req.body;
  const user = await User.findOne({ phone, pin }); // In production, use bcrypt to hash/compare
  if (!user) return res.status(401).json({ message: "Invalid PIN" });
  res.json({ message: "Success", user: { name: user.name, church: user.church } });
});

module.exports = app;