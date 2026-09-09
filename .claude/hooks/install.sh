#!/usr/bin/env bash
# Install git-behind.sh as a global SessionStart hook on THIS machine.
#
# Run it once per laptop:  bash .claude/hooks/install.sh
#
# Global settings (~/.claude/settings.json) do not travel with the repo, so a
# second machine needs this one command. The script it installs does travel
# with the repo, so a fix to the check itself reaches both machines by pull.
#
# Idempotent: re-running replaces the script and leaves a single hook entry.
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
DEST="$HOME/.claude/hooks"
SETTINGS="$HOME/.claude/settings.json"

mkdir -p "$DEST"
cp "$HERE/git-behind.sh" "$DEST/git-behind.sh"
chmod +x "$DEST/git-behind.sh"
echo "installed $DEST/git-behind.sh"

node - "$SETTINGS" <<'NODE'
const fs = require("fs");
const path = process.argv[2];

const settings = fs.existsSync(path)
  ? JSON.parse(fs.readFileSync(path, "utf8"))
  : {};

settings.hooks = settings.hooks || {};
const starts = (settings.hooks.SessionStart = settings.hooks.SessionStart || []);
const command = 'bash "$HOME/.claude/hooks/git-behind.sh"';

// Drop any earlier copy of this hook so re-running never stacks warnings.
for (const group of starts) {
  group.hooks = (group.hooks || []).filter((h) => h.command !== command);
}
const kept = starts.filter((g) => (g.hooks || []).length > 0);

kept.push({
  hooks: [
    {
      type: "command",
      command,
      timeout: 20,
      statusMessage: "Checking the remote...",
    },
  ],
});
settings.hooks.SessionStart = kept;

fs.writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
console.log("wired SessionStart hook into " + path);
NODE

echo
echo "Done. It takes effect in your NEXT Claude Code session, not this one."
