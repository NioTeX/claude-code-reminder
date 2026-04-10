#!/usr/bin/env node
// MCP server — Claude Code skill for managing reminders.
// Tools: add_reminder, list_reminders, delete_reminder, snooze_reminder, acknowledge_reminder

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { addReminder, load, deleteReminder, acknowledgeReminder, snoozeReminder, pauseReminder, resumeReminder } from "./lib/store.js";
import { describeRecurrence } from "./lib/recurrence.js";
import { parseDatetime } from "./lib/parse-datetime.js";
import { config } from "dotenv";
import { dirname } from "path";
import { fileURLToPath } from "url";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: `${__dirname}/.env` });

const TIMEZONE = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const DATA_DIR = process.env.REMINDERS_DIR || __dirname;
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "8787");

const server = new Server(
  { name: "reminders", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      experimental: { "claude/channel": {} },
    },
    instructions: [
      "You have a reminders and scheduled tasks system.",
      "Use add_reminder to schedule one-time reminders or recurring scheduled tasks.",
      "Smart datetime parsing: '5pm', 'tomorrow 9am', 'in 30 minutes', '2026-04-15 09:00'.",
      "For recurring tasks, set the recurrence field: 'daily', 'weekly', 'weekdays', 'monthly', 'yearly',",
      "'every 2 weeks', 'every monday', 'every monday,wednesday,friday', 'every 15th'.",
      'Due reminders arrive as <channel source="reminders"> notifications.',
      "When you receive one, call acknowledge_reminder with its ID so the system",
      "knows you handled it. If you don't acknowledge within a few minutes, it",
      "falls back to Telegram directly.",
      "Use pause_schedule/resume_schedule to temporarily stop/start recurring tasks.",
    ].join(" "),
  }
);

const TOOLS = [
  {
    name: "add_reminder",
    description: "Schedule a new reminder or recurring task. Datetime accepts natural formats: '5pm', 'tomorrow 9am', 'in 30 minutes', '2026-04-15 09:00'. For recurring: set recurrence to 'daily', 'weekly', 'weekdays', 'monthly', 'every monday', 'every 2 weeks', etc.",
    inputSchema: {
      type: "object",
      properties: {
        datetime: { type: "string", description: "When to first remind (smart parsing)" },
        message: { type: "string", description: "Reminder text" },
        target: { type: "string", description: "Optional: 'telegram:<chat_id>' — defaults to .env TELEGRAM_CHAT_ID" },
        recurrence: { type: "string", description: "Optional recurrence rule: 'daily', 'weekly', 'weekdays', 'monthly', 'yearly', 'every N days/weeks/months', 'every monday', 'every monday,friday', 'every 15th'" },
      },
      required: ["datetime", "message"],
    },
  },
  {
    name: "list_reminders",
    description: "List reminders and scheduled tasks, optionally filtered by status or only recurring.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter: pending, delivered, acked, telegram_sent. Omit for all.", enum: ["pending", "delivered", "acked", "telegram_sent"] },
        recurring_only: { type: "boolean", description: "If true, only show recurring/scheduled tasks" },
      },
    },
  },
  {
    name: "delete_reminder",
    description: "Delete a reminder by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "snooze_reminder",
    description: "Snooze a reminder — reschedule to a new time.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        datetime: { type: "string", description: "New datetime (smart parsing)" },
      },
      required: ["id", "datetime"],
    },
  },
  {
    name: "acknowledge_reminder",
    description: "Mark a reminder as acknowledged. Call this when you receive a reminder via the bus so it doesn't fall back to Telegram.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "pause_schedule",
    description: "Pause a recurring scheduled task. It won't fire until resumed.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "resume_schedule",
    description: "Resume a paused recurring scheduled task.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "add_reminder": {
        const iso = parseDatetime(args.datetime, TIMEZONE);
        const target = args.target || `telegram:${process.env.TELEGRAM_CHAT_ID || ""}`;
        const r = addReminder(DATA_DIR, { datetime: iso, message: args.message, target, recurrence: args.recurrence });
        const recurDesc = r.recurrence ? ` (${describeRecurrence(r.recurrence)})` : "";
        return { content: [{ type: "text", text: `Reminder set for ${r.datetime}${recurDesc}: "${r.message}" [${r.id}]` }] };
      }

      case "list_reminders": {
        let reminders = load(DATA_DIR);
        if (args?.status) reminders = reminders.filter((r) => r.status === args.status);
        if (args?.recurring_only) reminders = reminders.filter((r) => r.recurrence);
        if (reminders.length === 0) return { content: [{ type: "text", text: "No reminders found." }] };
        const lines = reminders.map((r) => {
          const recurTag = r.recurrence ? ` [${describeRecurrence(r.recurrence)}]` : "";
          const pausedTag = r.paused ? " (PAUSED)" : "";
          return `[${r.id}] ${r.datetime} — ${r.message} (${r.status})${recurTag}${pausedTag}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "delete_reminder": {
        const removed = deleteReminder(DATA_DIR, args.id);
        if (!removed) return { content: [{ type: "text", text: `Reminder ${args.id} not found.` }] };
        return { content: [{ type: "text", text: `Deleted: "${removed.message}"` }] };
      }

      case "snooze_reminder": {
        const iso = parseDatetime(args.datetime, TIMEZONE);
        const r = snoozeReminder(DATA_DIR, args.id, iso);
        if (!r) return { content: [{ type: "text", text: `Reminder ${args.id} not found.` }] };
        return { content: [{ type: "text", text: `Snoozed to ${r.datetime}: "${r.message}"` }] };
      }

      case "acknowledge_reminder": {
        const r = acknowledgeReminder(DATA_DIR, args.id);
        if (!r) return { content: [{ type: "text", text: `Reminder ${args.id} not found.` }] };
        return { content: [{ type: "text", text: `Acknowledged: "${r.message}"` }] };
      }

      case "pause_schedule": {
        const r = pauseReminder(DATA_DIR, args.id);
        if (!r) return { content: [{ type: "text", text: `Reminder ${args.id} not found.` }] };
        if (!r.recurrence) return { content: [{ type: "text", text: `"${r.message}" is not a recurring task.` }] };
        return { content: [{ type: "text", text: `Paused: "${r.message}" (${describeRecurrence(r.recurrence)})` }] };
      }

      case "resume_schedule": {
        const r = resumeReminder(DATA_DIR, args.id);
        if (!r) return { content: [{ type: "text", text: `Reminder ${args.id} not found.` }] };
        return { content: [{ type: "text", text: `Resumed: "${r.message}"` }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

// --- HTTP webhook for check.js to POST due reminders ---
// check.js sends { id, message, recurrence? } and we emit a channel notification
// so Claude sees the reminder in conversation.

const httpServer = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    res.writeHead(400);
    res.end("invalid json");
    return;
  }

  const { id, message, recurrence } = data;
  if (!id || !message) {
    res.writeHead(400);
    res.end("missing id or message");
    return;
  }

  try {
    const recurTag = recurrence ? ` [${recurrence}]` : "";
    await server.notification({
      method: "notifications/claude/channel",
      params: {
        content: `Reminder due [${id}]: ${message}${recurTag}\n\nCall acknowledge_reminder({ id: "${id}" }) to confirm you've seen this.`,
        meta: { source: "reminders", id, recurrence: recurrence || "" },
      },
    });
    res.writeHead(200);
    res.end("ok");
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

httpServer.on("error", (err) => {
  process.stderr.write(`[reminders] webhook listen failed on :${WEBHOOK_PORT}: ${err.message}\n`);
});

httpServer.listen(WEBHOOK_PORT, "127.0.0.1", () => {
  process.stderr.write(`[reminders] webhook listening on :${WEBHOOK_PORT}\n`);
});

// --- MCP transport ---
const transport = new StdioServerTransport();
await server.connect(transport);
