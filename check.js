#!/usr/bin/env node
// check.js — Cron script. Runs every minute.
//
// Delivery chain for due reminders:
//   1. Webhook → POST to MCP server's HTTP endpoint (works if Claude session is running)
//   2. Bus → POST to HQ Bus broker (optional, for multi-session setups)
//   3. Telegram → Direct API fallback (when Claude doesn't respond in time)
//
// Recurrence: when a recurring reminder fires, the next occurrence is auto-spawned.
//
// Usage: node check.js
// Cron:  * * * * * cd /path/to/claude-code-reminders && node check.js >> check.log 2>&1

import { load, addReminder, markDelivered, markTelegramSent } from "./lib/store.js";
import { nextOccurrence } from "./lib/recurrence.js";
import { config } from "dotenv";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: `${__dirname}/.env` });

const DATA_DIR = process.env.REMINDERS_DIR || __dirname;
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || "8787";
const WEBHOOK_URL = `http://127.0.0.1:${WEBHOOK_PORT}`;
const BUS_BROKER_URL = process.env.BUS_BROKER_URL || "";
const BUS_TARGET_SESSION = process.env.BUS_TARGET_SESSION || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ACK_TIMEOUT = parseInt(process.env.ACK_TIMEOUT_MINUTES || "2") * 60 * 1000;

const now = Date.now();

// --- Phase 1: Send due pending reminders ---
const reminders = load(DATA_DIR);
const due = reminders.filter((r) => {
  if (r.status !== "pending") return false;
  if (r.paused) return false;
  const t = new Date(r.datetime).getTime();
  return t > 0 && t <= now;
});

for (const r of due) {
  let delivered = false;

  // Try 1: Webhook to MCP server (Claude session running locally)
  delivered = await tryWebhook(r);

  // Try 2: HQ Bus (optional, for multi-session setups)
  if (!delivered && BUS_BROKER_URL) {
    delivered = await tryBus(r);
  }

  if (delivered) {
    markDelivered(DATA_DIR, r.id);
    log(`Delivered [${r.id}]: ${r.message}`);
  } else {
    // No Claude session reachable — send directly to Telegram
    await sendTelegram(r, "No active Claude session");
  }

  // Spawn next occurrence for recurring reminders
  if (r.recurrence) {
    spawnNextOccurrence(r);
  }
}

// --- Phase 2: Escalate unacknowledged reminders to Telegram ---
const stale = load(DATA_DIR).filter((r) => {
  if (r.status !== "delivered" || !r.deliveredAt) return false;
  const elapsed = now - new Date(r.deliveredAt).getTime();
  return elapsed > ACK_TIMEOUT;
});

for (const r of stale) {
  await sendTelegram(r, "Claude didn't respond in time");
}

// --- Delivery methods ---

async function tryWebhook(reminder) {
  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reminder.id,
        message: reminder.message,
        recurrence: reminder.recurrence || null,
      }),
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function tryBus(reminder) {
  const recurTag = reminder.recurrence ? ` [${reminder.recurrence}]` : "";
  const content = `⏰ Reminder [${reminder.id}]: ${reminder.message}${recurTag}\n\nTo acknowledge, call: acknowledge_reminder({ id: "${reminder.id}" })`;

  try {
    const resp = await fetch(`${BUS_BROKER_URL}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: BUS_TARGET_SESSION,
        from: "reminders",
        content,
      }),
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function sendTelegram(reminder, reason) {
  if (!TELEGRAM_BOT_TOKEN) {
    log(`No TELEGRAM_BOT_TOKEN — cannot send fallback for [${reminder.id}]`);
    return;
  }

  const chatId = extractChatId(reminder.target) || TELEGRAM_CHAT_ID;
  if (!chatId) {
    log(`No chat ID for [${reminder.id}]`);
    return;
  }

  const text = `⏰ Reminder: ${reminder.message}\n\n📡 ${reason} — sending directly.`;

  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(5000),
      }
    );
    const data = await resp.json();

    if (data.ok) {
      markTelegramSent(DATA_DIR, reminder.id);
      log(`Telegram sent [${reminder.id}]: ${reminder.message} (${reason})`);
    } else {
      log(`Telegram failed [${reminder.id}]: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    log(`Telegram error [${reminder.id}]: ${err.message}`);
  }
}

// --- Helpers ---

function extractChatId(target) {
  if (!target) return null;
  const m = target.match(/^telegram:(.+)$/);
  return m ? m[1] : null;
}

function spawnNextOccurrence(reminder) {
  try {
    const nextDt = nextOccurrence(reminder.recurrence, reminder.datetime);
    const next = addReminder(DATA_DIR, {
      datetime: nextDt,
      message: reminder.message,
      target: reminder.target,
      recurrence: reminder.recurrence,
    });
    log(`Spawned next [${next.id}] for ${nextDt}: ${reminder.message} (${reminder.recurrence})`);
  } catch (err) {
    log(`Failed to spawn next for [${reminder.id}]: ${err.message}`);
  }
}

function log(msg) {
  console.error(`[${new Date().toISOString()}] ${msg}`);
}
