// store.js — Read/write reminders from a JSON file.
// Each reminder: { id, datetime, message, target, status, recurrence?, paused?, deliveredAt }
// Status flow: pending → delivered → acked | telegram_sent
// Recurring reminders have a recurrence rule and auto-spawn the next occurrence when fired.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";

export function getStorePath(dir) {
  return `${dir}/reminders.json`;
}

export function load(dir) {
  const path = getStorePath(dir);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

export function save(dir, reminders) {
  mkdirSync(dir, { recursive: true });
  const target = getStorePath(dir);
  const tmp = join(dir, `.reminders.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(reminders, null, 2) + "\n");
  renameSync(tmp, target);
}

export function genId() {
  return randomBytes(4).toString("hex");
}

export function addReminder(dir, { datetime, message, target, recurrence }) {
  const reminders = load(dir);
  const reminder = {
    id: genId(),
    datetime,
    message,
    target: target || null,
    status: "pending",
    recurrence: recurrence || null,
    paused: false,
    createdAt: new Date().toISOString(),
    deliveredAt: null,
  };
  reminders.push(reminder);
  save(dir, reminders);
  return reminder;
}

export function pauseReminder(dir, id) {
  const reminders = load(dir);
  const r = reminders.find((r) => r.id === id);
  if (!r) return null;
  r.paused = true;
  save(dir, reminders);
  return r;
}

export function resumeReminder(dir, id) {
  const reminders = load(dir);
  const r = reminders.find((r) => r.id === id);
  if (!r) return null;
  r.paused = false;
  save(dir, reminders);
  return r;
}

export function deleteReminder(dir, id) {
  const reminders = load(dir);
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const [removed] = reminders.splice(idx, 1);
  save(dir, reminders);
  return removed;
}

export function acknowledgeReminder(dir, id) {
  const reminders = load(dir);
  const r = reminders.find((r) => r.id === id);
  if (!r) return null;
  r.status = "acked";
  r.ackedAt = new Date().toISOString();
  save(dir, reminders);
  return r;
}

export function snoozeReminder(dir, id, newDatetime) {
  const reminders = load(dir);
  const r = reminders.find((r) => r.id === id);
  if (!r) return null;
  r.datetime = newDatetime;
  r.status = "pending";
  r.deliveredAt = null;
  save(dir, reminders);
  return r;
}

export function markDelivered(dir, id) {
  const reminders = load(dir);
  const r = reminders.find((r) => r.id === id);
  if (!r) return null;
  r.status = "delivered";
  r.deliveredAt = new Date().toISOString();
  save(dir, reminders);
  return r;
}

export function markTelegramSent(dir, id) {
  const reminders = load(dir);
  const r = reminders.find((r) => r.id === id);
  if (!r) return null;
  r.status = "telegram_sent";
  r.telegramSentAt = new Date().toISOString();
  save(dir, reminders);
  return r;
}
