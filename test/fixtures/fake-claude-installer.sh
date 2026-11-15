#!/bin/bash
# A stand-in for Anthropic's installer: puts the fake claude where the real
# installer puts claude.
set -e
mkdir -p "$HOME/.local/bin"
cp "$FAKE_CLAUDE_SOURCE" "$HOME/.local/bin/claude"
chmod 755 "$HOME/.local/bin/claude"
echo "✅ Installation complete!"
