# claude-code-reminders

Reminders and scheduled tasks for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Tell Claude to remind you of something, it handles the rest.

> **WARNING:** This is an experimental project. It is provided as-is with no warranty or guarantee of any kind. Use at your own risk. Do not rely on this for critical or time-sensitive reminders. The author is not responsible for missed reminders, lost data, or any consequences of using this software.

## What it does

You tell Claude things like *"remind me to pay taxes on the 15th"* or *"every weekday at 9am, remind me to check email."* Claude creates the reminder using the MCP tools. A cron job checks every minute and delivers due reminders back to your Claude session. If Claude isn't running, it falls back to Telegram.

## Requirements

- **Node.js >= 18** (uses `fetch`, ES modules, `AbortSignal.timeout`)
- **Claude Code** with MCP server support
- **cron** (or any scheduler that can run a script every minute)
- **Telegram bot token** (optional, for fallback delivery when Claude isn't running)

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/nimrod-code/claude-code-reminders
cd claude-code-reminders
npm install
```

Or use the install script which also sets up cron:

```bash
bash install.sh
```

### 2. Configure

Copy the example env and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required for Telegram fallback (get from @BotFather on Telegram)
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id

# Optional: override webhook port (default 8787)
# WEBHOOK_PORT=8787

# Optional: timezone override (auto-detects from system by default)
# TIMEZONE=America/New_York
```

### 3. Add the MCP server to Claude Code

Add to your project's `.mcp.json`, or globally in `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "reminders": {
      "command": "node",
      "args": ["/absolute/path/to/claude-code-reminders/server.js"]
    }
  }
}
```

See `.mcp.json.example` for a template.

### 4. Set up the cron job

The cron job runs `check.js` every minute to find and deliver due reminders:

```bash
crontab -e
```

Add this line (replace paths with your actual paths):

```
* * * * * cd /path/to/claude-code-reminders && node check.js >> check.log 2>&1
```

If you used `bash install.sh`, this was done for you.

### 5. Use it

Start a Claude Code session. Claude now has reminder tools. Try:

- *"Remind me to call the dentist tomorrow at 3pm"*
- *"Every Monday at 9am, remind me to send the weekly report"*
- *"What reminders do I have?"*
- *"Snooze that reminder to Friday"*

## How delivery works

When a reminder is due, `check.js` tries to deliver it in order:

1. **Webhook** — POSTs to the MCP server's HTTP endpoint (port 8787 by default). If a Claude Code session is running, Claude sees it as a channel notification and can respond.
2. **HQ Bus** — (optional) If you have a message broker configured, tries that next. This is for advanced multi-session setups.
3. **Telegram** — If Claude doesn't acknowledge within N minutes (default: 2), sends directly to Telegram with a note: *"Claude didn't respond in time — sending directly."*

If no Claude session is running and no bus is configured, Telegram gets it immediately.

```
[Cron: every minute]
     |
     v
  Due reminder? (pending + not paused)
     |
     +-- Yes --> Webhook to MCP server (Claude session)
     |    |       |
     |    |       +-- Claude acks --> Done
     |    |       |
     |    |       +-- No ack in N min --> Telegram fallback
     |    |
     |    +-- Webhook fails --> HQ Bus (if configured), else Telegram
     |    |
     |    +-- Recurring? --> Auto-create next occurrence
     |
     +-- No --> Exit
```

## Configuration reference

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for fallback delivery | — |
| `TELEGRAM_CHAT_ID` | Default Telegram chat ID | — |
| `WEBHOOK_PORT` | Port the MCP server listens on for check.js | `8787` |
| `BUS_BROKER_URL` | HQ Bus broker URL (optional, leave empty to skip) | — |
| `BUS_TARGET_SESSION` | Target session on the bus | — |
| `ACK_TIMEOUT_MINUTES` | Minutes to wait for Claude before Telegram fallback | `2` |
| `TIMEZONE` | Timezone for parsing relative times | Auto-detect |
| `REMINDERS_DIR` | Directory to store reminders.json | Project root |

## MCP tools

These tools are available to Claude when the MCP server is configured:

| Tool | Description |
|------|-------------|
| `add_reminder` | Create a reminder. Smart datetime parsing: "5pm", "tomorrow 9am", "in 30 min", "2026-04-15 09:00". Optional `recurrence` for repeating tasks. |
| `list_reminders` | List all reminders. Filter by `status` or set `recurring_only: true`. |
| `delete_reminder` | Delete a reminder by ID. |
| `snooze_reminder` | Reschedule a reminder to a new time. |
| `acknowledge_reminder` | Confirm a delivered reminder was seen (prevents Telegram fallback). |
| `pause_schedule` | Pause a recurring task without deleting it. |
| `resume_schedule` | Resume a paused recurring task. |

## Recurring / scheduled tasks

Set the `recurrence` field when creating a reminder to make it repeat:

| Rule | Effect |
|------|--------|
| `daily` | Every day |
| `weekly` | Every 7 days |
| `weekdays` | Monday through Friday |
| `monthly` | Same day each month |
| `yearly` | Same day each year |
| `every N days` | Every N days (e.g., `every 3 days`) |
| `every N weeks` | Every N weeks |
| `every N months` | Every N months |
| `every monday` | Every Monday (any day name works) |
| `every monday,wednesday,friday` | Multiple days per week |
| `every 15th` | 15th of each month |

When a recurring reminder fires, the next occurrence is automatically created. Use `pause_schedule` / `resume_schedule` to temporarily stop a recurring task without losing the schedule.

## Project structure

```
claude-code-reminders/
  server.js            MCP server (tools + webhook listener)
  check.js             Cron script (checks due reminders, delivers them)
  lib/
    store.js           JSON storage (atomic writes)
    parse-datetime.js  Smart datetime parsing
    recurrence.js      Next occurrence calculation
  install.sh           Setup helper (deps + cron + config)
  .env.example         Configuration template
  .mcp.json.example    Claude Code MCP config template
  reminders.json       Data file (created automatically, gitignored)
```

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. THE AUTHOR MAKES NO GUARANTEES ABOUT THE RELIABILITY, ACCURACY, OR TIMELINESS OF REMINDERS DELIVERED BY THIS SOFTWARE. USE AT YOUR OWN RISK.

This is a personal project shared publicly. It works for the author's use case but has not been extensively tested across all environments, timezones, or edge cases. Known limitations:

- Timezone offsets use a simplified calculation that may be slightly off for half-hour zones (e.g., India, Nepal) or around DST transitions
- Recurring reminders store a fixed UTC offset, so schedules may drift by an hour across daylight saving changes
- No file locking between cron and MCP server (race window is small but exists)
- Cron-based, so minimum resolution is 1 minute

If you need bulletproof reminders, use your phone's built-in alarm app.

## License

MIT — see [LICENSE](LICENSE).
