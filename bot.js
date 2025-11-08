// bot.js — WhatsApp Tiffin Poll Bot (Stable v2.2)
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import P from "pino";
import fs from "fs";
import qrcode from "qrcode-terminal";

const AUTH_DIR = "auth";
const TIFFIN_GROUP_ID = "120363376426028053@g.us"; // 👈 your tiffin group ID

let pollActive = false;
let pollOwner = null;
let orders = new Map(); // user -> {full, half, chapati}

async function start() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log("🟢 Using WA Web version:", version.join("."), "| Latest:", isLatest);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 Scan this QR to link WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Connected to WhatsApp!");
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect =
        code !== DisconnectReason.loggedOut && code !== 401;
      console.log("❌ Disconnected:", code);
      if (shouldReconnect) {
        console.log("🔄 Reconnecting...");
        start();
      } else {
        console.log("🔐 Logged out — delete 'auth' folder and re-run.");
      }
    }
  });

  // 🔹 Listen only to the Tiffin group
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m?.message) return;
    if (m.key.fromMe) return; // ✅ prevent reply loops

    const jid = m.key.remoteJid;
    if (jid !== TIFFIN_GROUP_ID) return;

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
      "";
    const sender = m.pushName || "User";
    if (!text) return;

    const lower = text.trim().toLowerCase();

    // ───────────────────────────────
    // 🟩 START POLL
    // ───────────────────────────────
    if (lower === "!startpoll") {
      if (pollActive) {
        await sock.sendMessage(jid, {
          text: `⚠️ Poll already started by ${pollOwner}!`
        });
        return;
      }

      pollActive = true;
      pollOwner = sender;
      orders.clear();

      await sock.sendMessage(jid, {
        text:
          `🍱 *Tiffin Poll Started by ${sender}!* \n` +
          `Send your order in format:\n` +
          "`full X half Y chapati Z`\n\n" +
          "Example: `full 1 chapati 2`\n\n" +
          "Commands:\n" +
          "`!cancel` - cancel your order\n" +
          "`!showpoll` - view current orders\n" +
          "`!endpoll` - close poll (only by poll starter)"
      });
      return;
    }

    // ───────────────────────────────
    // 🟥 END POLL (only starter)
    // ───────────────────────────────
    if (lower === "!endpoll") {
      if (!pollActive) {
        await sock.sendMessage(jid, { text: "❌ No poll is active!" });
        return;
      }

      if (sender !== pollOwner) {
        await sock.sendMessage(jid, {
          text: `⚠️ Only ${pollOwner} can end this poll!`
        });
        return;
      }

      pollActive = false;
      let full = 0, half = 0, chapati = 0;
      let list = "";

      orders.forEach((o, name) => {
        full += o.full;
        half += o.half;
        chapati += o.chapati;
        list += `• ${name}: Full(${o.full}), Half(${o.half}), Chapati(${o.chapati})\n`;
      });

      const summary =
        `🛑 *Poll Ended by ${sender}*\n\n` +
        `🍱 *Total Orders:*\nFull: ${full}, Half: ${half}, Chapati: ${chapati}\n\n` +
        (list || "_No orders were placed_");

      await sock.sendMessage(jid, { text: summary });
      orders.clear();
      pollOwner = null;
      return;
    }

    // ───────────────────────────────
    // 🟨 CANCEL ORDER
    // ───────────────────────────────
    if (lower === "!cancel") {
      if (!pollActive) {
        await sock.sendMessage(jid, { text: "❌ No active poll to cancel!" });
        return;
      }

      if (orders.has(sender)) {
        orders.delete(sender);
        await sock.sendMessage(jid, { text: `🗑️ ${sender}, your order is cancelled.` });
      } else {
        await sock.sendMessage(jid, { text: `${sender}, you haven't placed an order yet.` });
      }
      return;
    }

    // ───────────────────────────────
    // 🟦 SHOW POLL STATUS
    // ───────────────────────────────
    if (lower === "!showpoll") {
      if (!pollActive) {
        await sock.sendMessage(jid, { text: "❌ No active poll right now!" });
        return;
      }

      let full = 0, half = 0, chapati = 0;
      let list = "";

      orders.forEach((o, name) => {
        full += o.full;
        half += o.half;
        chapati += o.chapati;
        list += `• ${name}: Full(${o.full}), Half(${o.half}), Chapati(${o.chapati})\n`;
      });

      const msg =
        `📋 *Current Poll (Started by ${pollOwner})*\n` +
        `Full: ${full}, Half: ${half}, Chapati: ${chapati}\n\n` +
        (list || "_No orders yet_");

      await sock.sendMessage(jid, { text: msg });
      return;
    }

    // ───────────────────────────────
    // 🟩 RECORD ORDER
    // ───────────────────────────────
    if (pollActive && /(full|half|chapati)/.test(lower)) {
      const full = parseInt((lower.match(/full\s*(\d+)/) || [])[1] || 0, 10);
      const half = parseInt((lower.match(/half\s*(\d+)/) || [])[1] || 0, 10);
      const chapati = parseInt((lower.match(/chapati\s*(\d+)/) || [])[1] || 0, 10);

      orders.set(sender, { full, half, chapati });
      await sock.sendMessage(jid, {
        text: `✅ ${sender}, your order is noted: Full(${full}), Half(${half}), Chapati(${chapati})`
      });
      return;
    }

    // ───────────────────────────────
    // 🟧 INVALID MESSAGE HANDLER
    // ───────────────────────────────
    if (pollActive && !/(full|half|chapati|!)/.test(lower)) {
      await sock.sendMessage(jid, {
        text: "ℹ️ Please send your order in format: `full X half Y chapati Z`"
      });
    }
  });
}

start().catch((err) => console.error("❌ Error starting bot:", err));