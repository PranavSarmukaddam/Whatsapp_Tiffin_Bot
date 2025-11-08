// =============================
// WhatsApp Tiffin Bot (Replit Version)
// Author: Pranav Sarmukaddam
// =============================

// ---- Imports ----
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";
import { Boom } from "@hapi/boom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from "http"; // For pinging (Replit keep-alive)

// ---- Basic setup ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authPath = path.join(__dirname, "auth");

// ---- Keep-Alive HTTP Server ----
// Replit needs an HTTP server to stay awake
http.createServer((req, res) => {
  res.end("✅ WhatsApp Tiffin Bot is running fine!");
}).listen(process.env.PORT || 3000);

// ---- Main WhatsApp Connection Function ----
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: P({ level: "silent" })
  });

  // ---- Connection Updates ----
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 Scan this QR to link your WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("⚠️ Connection closed, reconnecting...");
        connectToWhatsApp();
      } else {
        console.log("❌ Logged out. Scan QR again to reconnect.");
      }
    } else if (connection === "open") {
      console.log("✅ Connected to WhatsApp successfully!");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // ---- Message Handler ----
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.pushName || "User";
    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    console.log(`💬 Message from ${sender}: ${text}`);

    // ---- Simple commands for testing ----
    if (text.toLowerCase() === "!ping") {
      await sock.sendMessage(from, {
        text: "🏓 Pong! Bot is alive and running perfectly on Replit 🚀"
      });
    }

    if (text.toLowerCase() === "!help") {
      await sock.sendMessage(from, {
        text: "🧾 Available Commands:\n• !ping - Test bot\n• !help - Show this list"
      });
    }
  });
}

// ---- Start Bot ----
connectToWhatsApp();
