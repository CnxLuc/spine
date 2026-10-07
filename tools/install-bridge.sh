#!/bin/bash
# Runs the Claude bridge at login, so Spine can read with your Claude plan
# instead of an API key. Undo with tools/uninstall-bridge.sh.
#
# Afterwards, in Spine's settings: API address http://127.0.0.1:4777 (under
# Advanced) and, as the API key, the token this prints.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
label="com.spine.claude-bridge"
plist="$HOME/Library/LaunchAgents/$label.plist"
node="$(command -v node)"
claude="$(command -v claude)"
mkdir -p "$HOME/.config/spine"
chmod 700 "$HOME/.config/spine"

cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node</string>
    <string>$here/tools/claude-bridge.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$node"):$(dirname "$claude"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>CLAUDE_BIN</key><string>$claude</string>
  </dict>
  <key>WorkingDirectory</key><string>$HOME/.config/spine</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.config/spine/bridge.log</string>
  <key>StandardErrorPath</key><string>$HOME/.config/spine/bridge.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
sleep 1
echo "Bridge running on http://127.0.0.1:4777"
echo "Token for Spine's API key field: $(cat "$HOME/.config/spine/bridge-token")"
