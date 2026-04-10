// parse-datetime.js — Smart datetime parsing with timezone support.
// Accepts: "5pm", "17:15", "tomorrow 9am", "in 30 minutes", "2026-04-15 09:00", ISO strings.

export function parseDatetime(input, timezone) {
  if (!timezone) timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const offset = getTimezoneOffset(timezone);
  const now = nowLocal(timezone);
  const inputLower = input.toLowerCase().trim();

  // Already has timezone offset — use as-is
  if (/[+-]\d{2}:\d{2}$/.test(input)) return input;

  // "in X minutes/hours"
  const relMatch = inputLower.match(
    /^in\s+(\d+)\s*(min(?:ute)?s?|hours?|h|m)$/
  );
  if (relMatch) {
    const val = parseInt(relMatch[1]);
    const unit = relMatch[2].startsWith("h") ? 60 : 1;
    return formatLocal(new Date(now.getTime() + val * unit * 60000), offset);
  }

  // "tomorrow Xam/pm" or "tomorrow HH:MM"
  const tomorrowMatch = inputLower.match(/^tomorrow\s+(.+)$/);
  if (tomorrowMatch) {
    const time = parseTime(tomorrowMatch[1]);
    if (time) {
      const target = new Date(now);
      target.setDate(target.getDate() + 1);
      target.setHours(time.hours, time.minutes, 0, 0);
      return formatLocal(target, offset);
    }
  }

  // Time only — "17:15", "5:15pm", "5pm"
  const timeOnly = parseTime(inputLower);
  if (timeOnly && !inputLower.includes("-") && !inputLower.includes("/")) {
    const target = new Date(now);
    target.setHours(timeOnly.hours, timeOnly.minutes, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return formatLocal(target, offset);
  }

  // "YYYY-MM-DD HH:MM"
  const fullMatch = input.match(/^(\d{4}[-/]\d{2}[-/]\d{2})\s+(\d{1,2}:\d{2})$/);
  if (fullMatch) {
    const datePart = fullMatch[1].replace(/\//g, "-");
    return `${datePart}T${fullMatch[2].padStart(5, "0")}:00${offset}`;
  }

  // ISO without offset — assume local
  const isoNoOffset = input.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);
  if (isoNoOffset) return `${input}${offset}`;

  // Fallback
  const d = new Date(input);
  if (!isNaN(d.getTime())) return formatLocal(d, offset);

  throw new Error(`Cannot parse datetime: "${input}"`);
}

function parseTime(str) {
  const ampm = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2] || "0");
    if (ampm[3].toLowerCase() === "pm" && h !== 12) h += 12;
    if (ampm[3].toLowerCase() === "am" && h === 12) h = 0;
    return { hours: h, minutes: m };
  }
  const h24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return { hours: parseInt(h24[1]), minutes: parseInt(h24[2]) };
  return null;
}

function nowLocal(timezone) {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone })
  );
}

function getTimezoneOffset(timezone) {
  const now = new Date();
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const diffH = Math.round((local - utc) / 3600000);
  const sign = diffH >= 0 ? "+" : "-";
  return `${sign}${String(Math.abs(diffH)).padStart(2, "0")}:00`;
}

function formatLocal(date, offset) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:00${offset}`;
}
