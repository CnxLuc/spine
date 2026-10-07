#!/bin/bash
# Connects Spine to Claude Code and Codex on this computer, so Spine reads on
# your own Claude or ChatGPT plan instead of API credits.
#
#   curl -fsSL https://cnxluc.github.io/spine/connect.sh | bash
#   curl -fsSL https://cnxluc.github.io/spine/connect.sh | bash -s -- --uninstall
#
# It installs a small program that your browser starts when Spine asks for a
# reading, and that only Spine may start. The program runs your own Claude Code
# (`claude -p`) or Codex (`codex exec`), signed in as you; Spine never sees your
# sign-in. Nothing runs in the background.
set -euo pipefail

NAME="com.spine.local"
# Spine's extension ids: the downloaded version, then the Chrome Web Store one.
IDS=(__SPINE_EXTENSION_IDS__)
if [ -n "${SPINE_EXTENSION_IDS:-}" ]; then IDS+=(${SPINE_EXTENSION_IDS//,/ }); fi

case "$(uname -s)" in
  Darwin)
    DATA="$HOME/Library/Application Support"
    HOME_DIR="$DATA/Spine"
    BROWSERS=("Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "Arc/User Data" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Vivaldi" "Dia/User Data" "Aside" "Thorium" "Comet")
    ;;
  Linux)
    DATA="${XDG_CONFIG_HOME:-$HOME/.config}"
    HOME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/spine"
    BROWSERS=("google-chrome" "google-chrome-beta" "chromium" "BraveSoftware/Brave-Browser" "microsoft-edge" "vivaldi")
    ;;
  *)
    echo "Spine connects to Claude Code on macOS and Linux." >&2
    exit 1
    ;;
esac

say() { printf '%s\n' "$*"; }
fail() { printf 'Spine: %s\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  for browser in "${BROWSERS[@]}"; do rm -f "$DATA/$browser/NativeMessagingHosts/$NAME.json"; done
  rm -rf "$HOME_DIR"
  say "Removed Spine's connection to Claude Code and Codex. Spine will use an API key again if you set one."
  exit 0
fi

# Claude Code and Codex: whichever are installed, at least one.
find_tool() {
  local tool="$1" found
  found="$(command -v "$tool" 2>/dev/null || true)"
  for candidate in "$HOME/.local/bin/$tool" "$HOME/.claude/local/$tool" /opt/homebrew/bin/$tool /usr/local/bin/$tool "$HOME/.npm-global/bin/$tool"; do
    [ -z "$found" ] && [ -x "$candidate" ] && found="$candidate"
  done
  printf '%s' "$found"
}
CLAUDE="$(find_tool claude)"
CODEX="$(find_tool codex)"
[ -n "$CLAUDE$CODEX" ] || fail "Neither Claude Code nor Codex is installed. Install one (claude.com/claude-code or developers.openai.com/codex), sign in, then run this again."
if [ -n "$CLAUDE" ] && ! "$CLAUDE" auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
  say "Claude Code is installed but not signed in. Run: claude"
fi
if [ -n "$CODEX" ] && ! "$CODEX" login status >/dev/null 2>&1; then
  say "Codex is installed but not signed in. Run: codex login"
fi

# Python 3, which runs the small program. macOS has it with Apple's command
# line tools, which Claude Code users usually have already.
PYTHON=""
if [ "$(uname -s)" = "Darwin" ] && xcode-select -p >/dev/null 2>&1 && [ -x /usr/bin/python3 ]; then
  PYTHON=/usr/bin/python3
fi
[ -n "$PYTHON" ] || PYTHON="$(command -v python3 2>/dev/null || true)"
[ -n "$PYTHON" ] || fail "Spine needs Python 3. On a Mac, run: xcode-select --install"

mkdir -p "$HOME_DIR"
cat > "$HOME_DIR/spine_host.py" <<'SPINE_HOST'
__SPINE_HOST_PY__
SPINE_HOST
{
  printf '#!/bin/sh\n'
  [ -n "$CLAUDE" ] && printf 'export CLAUDE_BIN="%s"\n' "$CLAUDE"
  [ -n "$CODEX" ] && printf 'export CODEX_BIN="%s"\n' "$CODEX"
  printf 'exec "%s" "%s"\n' "$PYTHON" "$HOME_DIR/spine_host.py"
} > "$HOME_DIR/spine-host"
chmod 755 "$HOME_DIR/spine-host"

ORIGINS=""
for id in "${IDS[@]}"; do ORIGINS="$ORIGINS${ORIGINS:+, }\"chrome-extension://$id/\""; done
MANIFEST="{
  \"name\": \"$NAME\",
  \"description\": \"Spine: read with Claude Code or Codex on this computer\",
  \"path\": \"$HOME_DIR/spine-host\",
  \"type\": \"stdio\",
  \"allowed_origins\": [$ORIGINS]
}"

CONNECTED=()
for browser in "${BROWSERS[@]}"; do
  [ -d "$DATA/$browser" ] || continue
  mkdir -p "$DATA/$browser/NativeMessagingHosts"
  printf '%s\n' "$MANIFEST" > "$DATA/$browser/NativeMessagingHosts/$NAME.json"
  case "$browser" in
    Google/Chrome) CONNECTED+=("Chrome") ;;
    "Google/Chrome Beta") CONNECTED+=("Chrome Beta") ;;
    "Google/Chrome Canary") CONNECTED+=("Chrome Canary") ;;
    google-chrome) CONNECTED+=("Chrome") ;;
    google-chrome-beta) CONNECTED+=("Chrome Beta") ;;
    BraveSoftware/*) CONNECTED+=("Brave") ;;
    "Microsoft Edge" | microsoft-edge) CONNECTED+=("Edge") ;;
    *) CONNECTED+=("${browser%%/*}") ;;
  esac
done
[ ${#CONNECTED[@]} -gt 0 ] || fail "No supported browser found. Spine works in Chrome, Arc, Brave, Edge, Vivaldi, Dia and Aside."

TOOLS=()
[ -n "$CLAUDE" ] && TOOLS+=("Claude Code $("$CLAUDE" --version 2>/dev/null | head -1 | awk '{print $1}')")
[ -n "$CODEX" ] && TOOLS+=("Codex $("$CODEX" --version 2>/dev/null | head -1 | awk '{print $NF}')")
JOINED="${TOOLS[0]}"
[ ${#TOOLS[@]} -gt 1 ] && JOINED="$JOINED and ${TOOLS[1]}"
BROWSER_LIST="$(printf '%s, ' "${CONNECTED[@]}")"
say "Spine is connected to $JOINED in ${BROWSER_LIST%, }."
say "Open any article and press Option-Shift-S (Alt-Shift-S). Spine now reads on your own plan."
