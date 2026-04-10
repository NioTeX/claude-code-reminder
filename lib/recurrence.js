// recurrence.js — Calculate next occurrence from a recurrence rule + previous datetime.
//
// Supported rules:
//   "daily", "weekly", "weekdays", "monthly", "yearly"
//   "every N days", "every N weeks", "every N months"
//   "every monday", "every tuesday", ... (day names)
//   "every monday,wednesday,friday" (multiple days)
//   "every 1st", "every 15th" (day of month)

const DAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];
const DAY_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function nextOccurrence(rule, prevDatetime) {
  const prev = new Date(prevDatetime);
  if (isNaN(prev.getTime())) throw new Error(`Invalid datetime: ${prevDatetime}`);

  const r = rule.toLowerCase().trim();

  // Extract time from previous occurrence (preserve it)
  const hours = prev.getHours();
  const minutes = prev.getMinutes();
  const offset = extractOffset(prevDatetime);

  if (r === "daily" || r === "every day") {
    return makeDate(prev, 1, offset);
  }

  if (r === "weekly" || r === "every week") {
    return makeDate(prev, 7, offset);
  }

  if (r === "weekdays" || r === "every weekday") {
    const next = new Date(prev);
    do {
      next.setDate(next.getDate() + 1);
    } while (next.getDay() === 0 || next.getDay() === 6);
    return formatDate(next, offset);
  }

  if (r === "monthly" || r === "every month") {
    return addMonths(prev, 1, offset);
  }

  if (r === "yearly" || r === "every year") {
    return addMonths(prev, 12, offset);
  }

  // "every N days/weeks/months"
  const intervalMatch = r.match(/^every\s+(\d+)\s+(day|week|month)s?$/);
  if (intervalMatch) {
    const n = parseInt(intervalMatch[1]);
    const unit = intervalMatch[2];
    if (unit === "day") return makeDate(prev, n, offset);
    if (unit === "week") return makeDate(prev, n * 7, offset);
    if (unit === "month") return addMonths(prev, n, offset);
  }

  // "every monday", "every monday,wednesday,friday"
  const dayMatch = r.match(/^every\s+(.+)$/);
  if (dayMatch) {
    const dayStr = dayMatch[1];

    // Check for "1st", "15th" etc (day of month)
    const domMatch = dayStr.match(/^(\d{1,2})(?:st|nd|rd|th)$/);
    if (domMatch) {
      const targetDay = parseInt(domMatch[1]);
      const next = new Date(prev);
      next.setMonth(next.getMonth() + 1);
      next.setDate(targetDay);
      next.setHours(hours, minutes, 0, 0);
      return formatDate(next, offset);
    }

    // Parse day names
    const targetDays = dayStr.split(/[,\s]+/).map((d) => {
      const idx = DAY_NAMES.indexOf(d);
      if (idx !== -1) return idx;
      const abIdx = DAY_ABBREVS.indexOf(d);
      if (abIdx !== -1) return abIdx;
      return -1;
    }).filter((d) => d !== -1);

    if (targetDays.length > 0) {
      const next = new Date(prev);
      for (let i = 1; i <= 7; i++) {
        next.setDate(prev.getDate() + i);
        if (targetDays.includes(next.getDay())) {
          next.setHours(hours, minutes, 0, 0);
          return formatDate(next, offset);
        }
      }
    }
  }

  throw new Error(`Unknown recurrence rule: "${rule}"`);
}

export function describeRecurrence(rule) {
  const r = rule.toLowerCase().trim();
  if (r === "daily" || r === "every day") return "Daily";
  if (r === "weekly" || r === "every week") return "Weekly";
  if (r === "weekdays" || r === "every weekday") return "Weekdays";
  if (r === "monthly" || r === "every month") return "Monthly";
  if (r === "yearly" || r === "every year") return "Yearly";
  // Capitalize first letter for display
  return rule.charAt(0).toUpperCase() + rule.slice(1);
}

function makeDate(prev, addDays, offset) {
  const next = new Date(prev);
  next.setDate(next.getDate() + addDays);
  return formatDate(next, offset);
}

function addMonths(prev, n, offset) {
  const next = new Date(prev);
  const targetDay = next.getDate();
  next.setMonth(next.getMonth() + n);
  // Handle month overflow (e.g., Jan 31 + 1 month → Feb 28)
  if (next.getDate() !== targetDay) {
    next.setDate(0); // Last day of previous month
  }
  return formatDate(next, offset);
}

function formatDate(date, offset) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:00${offset}`;
}

function extractOffset(datetimeStr) {
  const m = datetimeStr.match(/([+-]\d{2}:\d{2})$/);
  return m ? m[1] : "+00:00";
}
