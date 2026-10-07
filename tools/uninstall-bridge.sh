#!/bin/bash
# Stops the Claude bridge and removes it from login. Keeps the token, so
# installing again keeps Spine's settings working.
set -euo pipefail
label="com.spine.claude-bridge"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$label.plist"
echo "Bridge stopped and removed. Point Spine back at Anthropic by clearing its API address and adding an API key."
