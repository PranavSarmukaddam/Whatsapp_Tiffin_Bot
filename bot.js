// =============================
// WhatsApp Tiffin Bot (Multi-Poll Edition)
// Author: Pranav Sarmukaddam
// =============================

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";
import { Boom } from "@hapi/boom";
import http from "http"; // For Replit keep-alive
import path from "path";
import { fileURLToPath } from "url";

// --- Setup paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authPath = path.join(__dirname, "auth");

// --- Keep-alive server for UptimeRobot ---
http.createServer((req, res) => {
  res.end("✅ WhatsApp Tiffin Bot is running fine!");
}).listen(process.env.PORT || 3000);

// --- Poll Storage ---
let polls = {}; // Example: { lunch: {active: true, orders: {...}}, dinner: {...} }
let currentPoll = null;

// --- Helper: Calculate totals for a poll ---
function calculateTotals(orders) {
  let totalHalf = 0, totalFull = 0, totalChapati = 0;
  Object.values(orders).forEach(order => {
    totalHalf += order.half || 0;
    totalFull += order.full || 0;
    totalChapati += order.chapati || 0;
  });
  return { totalHalf, totalFull, totalChapati };
}

// --- WhatsApp connection setup ---
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: P({ level: "silent" })
  });

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

  // --- Main message handler ---
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const sender = msg.pushName || "User";
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    const lower = text.toLowerCase().trim();

    // --- Ping ---
    if (lower === "!ping") {
      await sock.sendMessage(from, { text: "🏓 Pong! Bot is alive." });
      return;
    }

    // --- Help ---
    if (lower === "!help") {
      await sock.sendMessage(from, {
        text:
          "🧾 Commands:\n" +
          "• !startpoll [name] - Start new poll (e.g., !startpoll lunch)\n" +
          "• !showpoll [name] - Show all orders for a poll\n" +
          "• !cancel - Cancel your order in current poll\n" +
          "• !endpoll [name] - End a poll\n" +
          "\nAfter starting, send orders like:\n'half 2, chapati 3' or 'full 1'"
      });
      return;
    }

    // --- Start Poll ---
    if (lower.startsWith("!startpoll")) {
      const parts = lower.split(" ");
      const pollName = parts[1] || "default";

      if (polls[pollName]?.active) {
        await sock.sendMessage(from, {
          text: `⚠️ Poll '${pollName}' is already active!`,
        });
      } else {
        polls[pollName] = { active: true, orders: {} };
        currentPoll = pollName;
        await sock.sendMessage(from, {
          text: `📋 Poll '${pollName}' started!\nSend your orders like:\n'half 2, chapati 3'\nUse !cancel to cancel your order.\nUse !showpoll ${pollName} to see totals.\nUse !endpoll ${pollName} to end it.`,
        });
      }
      return;
    }

    // --- End Poll ---
    if (lower.startsWith("!endpoll")) {
      const parts = lower.split(" ");
      const pollName = parts[1] || currentPoll;

      if (!pollName || !polls[pollName]?.active) {
        await sock.sendMessage(from, { text: "⚠️ No such active poll found." });
      } else {
        const poll = polls[pollName];
        poll.active = false;
        const { totalHalf, totalFull, totalChapati } = calculateTotals(poll.orders);

        let summary = `📦 Poll '${pollName}' Ended!\n\n`;
        Object.entries(poll.orders).forEach(([name, o]) => {
          summary += `👤 ${name}: ${o.half || 0} Half, ${o.full || 0} Full, ${o.chapati || 0} Chapati\n`;
        });
        summary += `\n📊 Totals:\nHalf: ${totalHalf}\nFull: ${totalFull}\nChapati: ${totalChapati}`;

        await sock.sendMessage(from, { text: summary });
      }
      return;
    }

    // --- Show Poll ---
    if (lower.startsWith("!showpoll")) {
      const parts = lower.split(" ");
      const pollName = parts[1] || currentPoll;

      if (!pollName || !polls[pollName]?.active) {
        await sock.sendMessage(from, { text: "⚠️ No active poll found." });
      } else {
        const poll = polls[pollName];
        const { totalHalf, totalFull, totalChapati } = calculateTotals(poll.orders);

        if (Object.keys(poll.orders).length === 0) {
          await sock.sendMessage(from, { text: "📭 No orders yet for this poll." });
          return;
        }

        let summary = `📋 Current Orders for '${pollName}':\n`;
        Object.entries(poll.orders).forEach(([name, o]) => {
          summary += `👤 ${name}: ${o.half || 0} Half, ${o.full || 0} Full, ${o.chapati || 0} Chapati\n`;
        });
        summary += `\n📊 Totals:\nHalf: ${totalHalf}\nFull: ${totalFull}\nChapati: ${totalChapati}`;
        await sock.sendMessage(from, { text: summary });
      }
      return;
    }

    // --- Cancel Order ---
    if (lower === "!cancel") {
      if (!currentPoll || !polls[currentPoll]?.active) {
        await sock.sendMessage(from, { text: "⚠️ No active poll to cancel from." });
      } else if (!polls[currentPoll].orders[sender]) {
        await sock.sendMessage(from, { text: "❌ You haven’t placed any order yet." });
      } else {
        delete polls[currentPoll].orders[sender];
        await sock.sendMessage(from, { text: "🗑️ Your order has been cancelled." });
      }
      return;
    }

    // --- Order Parsing ---
    if (currentPoll && polls[currentPoll]?.active) {
      const halfMatch = lower.match(/half\s*(\d+)/);
      const fullMatch = lower.match(/full\s*(\d+)/);
      const chapatiMatch = lower.match(/chapati\s*(\d+)/);

      const order = {
        half: halfMatch ? parseInt(halfMatch[1]) : 0,
        full: fullMatch ? parseInt(fullMatch[1]) : 0,
        chapati: chapatiMatch ? parseInt(chapatiMatch[1]) : 0,
      };

      if (order.half || order.full || order.chapati) {
        polls[currentPoll].orders[sender] = order;
        await sock.sendMessage(from, {
          text: `✅ Order noted for ${sender} in '${currentPoll}':\nHalf: ${order.half}\nFull: ${order.full}\nChapati: ${order.chapati}`,
        });
      }
    }
  });
}

connectToWhatsApp();
