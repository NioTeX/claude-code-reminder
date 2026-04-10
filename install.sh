#!/usr/bin/env bash
# install.sh — Set up claude-code-reminders: install deps, create .env, install cron.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== claude-code-reminders setup ==="
echo ""

# 1. Check Node version
NODE_PATH=$(which node 2>/dev/null || true)
if [[ -z "$NODE_PATH" ]]; then
  echo "Error: Node.js not found. Install Node.js >= 18: https://nodejs.org"
  exit 1
fi
NODE_VER=$("$NODE_PATH" -e "console.log(process.versions.node.split('.')[0])")
if [[ "$NODE_VER" -lt 18 ]]; then
  echo "Error: Node.js >= 18 required (found v$("$NODE_PATH" --version))"
  exit 1
fi
echo "Node.js: $("$NODE_PATH" --version)"

# 2. Install dependencies
echo "Installing dependencies..."
cd "$DIR" && npm install --silent
echo "Done."
echo ""

# 3. Create .env if missing
if [[ ! -f "$DIR/.env" ]]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "Created .env from template. Edit it with your Telegram token and chat ID:"
  echo "  $DIR/.env"
  echo ""
fi

# 4. Install cron job (skip if crontab not available)
if command -v crontab &>/dev/null; then
  CRON_CMD="* * * * * cd \"$DIR\" && \"$NODE_PATH\" \"$DIR/check.js\" >> \"$DIR/check.log\" 2>&1"

  if crontab -l 2>/dev/null | grep -qF "claude-code-reminders/check.js"; then
    echo "Cron job already installed."
  else
    (crontab -l 2>/dev/null || true; echo "$CRON_CMD") | crontab -
    echo "Cron job installed: every minute."
  fi
else
  echo "Warning: crontab not found. Set up a cron job manually:"
  echo "  * * * * * cd \"$DIR\" && node check.js >> check.log 2>&1"
fi
echo ""

# 5. Show .mcp.json snippet
echo "Add this to your Claude Code MCP config (.mcp.json or ~/.claude/.mcp.json):"
echo ""
cat <<JSONEOF
{
  "mcpServers": {
    "reminders": {
      "command": "node",
      "args": ["$DIR/server.js"]
    }
  }
}
JSONEOF
echo ""
echo "Setup complete!"
