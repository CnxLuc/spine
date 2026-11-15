#!/bin/bash
# Connects Spine to your Claude plan, through Claude Code on this computer, so
# Spine reads on your Claude Pro or Max plan with nothing extra to pay. It
# connects Codex too, if you have it.
#
#   curl -fsSL https://cnxluc.github.io/spine/connect.sh | bash
#   curl -fsSL https://cnxluc.github.io/spine/connect.sh | bash -s -- --uninstall
#
# 1. If Claude Code isn't installed, it offers to install it with Anthropic's
#    own installer (claude.ai/install.sh).
# 2. If Claude Code isn't signed in, it runs Anthropic's own sign-in
#    (`claude auth login`), which opens your browser.
# 3. It adds Spine's connector: a short script your browser starts when Spine
#    asks for a reading, and that only Spine may start. The script runs your
#    own Claude Code (`claude -p`) or Codex (`codex exec`), signed in as you.
#    Spine never sees your sign-in, and nothing runs in the background.
#
# Add --yes to answer yes to every question.
set -euo pipefail

NAME="com.spine.local"
# Spine's extension ids: the downloaded version, then the Chrome Web Store one.
IDS=(__SPINE_EXTENSION_IDS__)
if [ -n "${SPINE_EXTENSION_IDS:-}" ]; then IDS+=(${SPINE_EXTENSION_IDS//,/ }); fi
CLAUDE_INSTALLER="${SPINE_CLAUDE_INSTALLER:-https://claude.ai/install.sh}"

bold=""
dim=""
plain=""
if [ -t 1 ]; then
  bold=$'\033[1m'
  dim=$'\033[2m'
  plain=$'\033[0m'
fi
say() { printf '%s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$bold" "$*" "$plain"; }
fail() {
  printf '\nSpine: %s\n' "$*" >&2
  exit 1
}

YES=0
# Questions go to the terminal, since this script arrives on standard input.
TTY=0
if [ "${SPINE_TTY:-}" != 0 ] && (: </dev/tty) 2>/dev/null; then TTY=1; fi
ask() {
  local answer=""
  if [ "$YES" = 1 ]; then return 0; fi
  if [ "$TTY" = 0 ]; then return 1; fi
  printf '%s [Y/n] ' "$1" >/dev/tty
  IFS= read -r answer </dev/tty || answer=n
  case $answer in "" | y | Y | yes | Yes | YES) return 0 ;; *) return 1 ;; esac
}

setup_paths() {
  case "$(uname -s)" in
    Darwin)
      DATA="$HOME/Library/Application Support"
      # A folder no other app uses: Esoteric Software's Spine, an animation
      # editor, keeps its backups in Application Support/Spine.
      HOME_DIR="$DATA/com.spine.local"
      OLD_DIR="$DATA/Spine"
      BROWSERS=("Google/Chrome" "Google/Chrome Beta" "Google/Chrome Dev" "Google/Chrome Canary" "Chromium" "Arc/User Data" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Vivaldi" "Dia/User Data" "Aside" "Thorium" "Comet")
      ;;
    Linux)
      DATA="${XDG_CONFIG_HOME:-$HOME/.config}"
      HOME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/com.spine.local"
      OLD_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/spine"
      BROWSERS=("google-chrome" "google-chrome-beta" "google-chrome-unstable" "chromium" "BraveSoftware/Brave-Browser" "microsoft-edge" "vivaldi")
      ;;
    *)
      fail "this command is for Mac and Linux. On Windows, follow the steps at cnxluc.github.io/spine."
      ;;
  esac
}

browser_name() {
  case "$1" in
    Google/Chrome | google-chrome) printf 'Chrome' ;;
    "Google/Chrome Beta" | google-chrome-beta) printf 'Chrome Beta' ;;
    "Google/Chrome Dev" | google-chrome-unstable) printf 'Chrome Dev' ;;
    "Google/Chrome Canary") printf 'Chrome Canary' ;;
    BraveSoftware/*) printf 'Brave' ;;
    "Microsoft Edge" | microsoft-edge) printf 'Edge' ;;
    chromium) printf 'Chromium' ;;
    vivaldi) printf 'Vivaldi' ;;
    *) printf '%s' "${1%%/*}" ;;
  esac
}

# Spine 1.2 and 1.3.0 kept the connector in a folder named Spine, which
# another app may share. Remove only the files the connector put there.
tidy_old() {
  [ -d "$OLD_DIR" ] || return 0
  rm -f "$OLD_DIR/spine_host.py" "$OLD_DIR/spine-host" "$OLD_DIR/spine-host.sh"
  if [ -d "$OLD_DIR/work" ]; then
    rm -rf "$OLD_DIR/work"/run.* "$OLD_DIR/work"/spine-*.json
    rmdir "$OLD_DIR/work" 2>/dev/null || true
  fi
  rmdir "$OLD_DIR" 2>/dev/null || true
}

uninstall() {
  for browser in "${BROWSERS[@]}"; do rm -f "$DATA/$browser/NativeMessagingHosts/$NAME.json"; done
  rm -rf "$HOME_DIR"
  tidy_old
  say "Removed Spine's connection to Claude Code and Codex. Claude Code itself stays installed."
}

# Claude Code or Codex: on the PATH, or where their installers put them.
find_tool() {
  local tool="$1" found candidate
  found="$(command -v "$tool" 2>/dev/null || true)"
  for candidate in "$HOME/.local/bin/$tool" "$HOME/.claude/local/$tool" "/opt/homebrew/bin/$tool" "/usr/local/bin/$tool" "$HOME/.npm-global/bin/$tool" "$HOME/.bun/bin/$tool"; do
    if [ -z "$found" ] && [ -x "$candidate" ]; then found="$candidate"; fi
  done
  printf '%s' "$found"
}

claude_signed_in() {
  "$CLAUDE" auth status </dev/null 2>/dev/null | grep -q '"loggedIn": *true'
}

install_claude() {
  step "Installing Claude Code, with Anthropic's installer"
  if ! curl -fsSL "$CLAUDE_INSTALLER" | bash; then
    say "Claude Code didn't install. You can try again later with: curl -fsSL https://claude.ai/install.sh | bash"
    return 1
  fi
  CLAUDE="$(find_tool claude)"
  [ -n "$CLAUDE" ]
}

sign_in_claude() {
  step "Signing in to Claude"
  say "Your browser opens Claude's sign-in. Sign in with the account that has your Pro or Max plan, then come back here."
  if [ "$TTY" = 1 ]; then
    "$CLAUDE" auth login </dev/tty || true
  else
    "$CLAUDE" auth login </dev/null || true
  fi
  claude_signed_in
}

install_connector() {
  local host_file="$HOME_DIR/spine-host.sh" wrapper="$HOME_DIR/spine-host" origins="" id manifest browser
  mkdir -p "$HOME_DIR/work"
  tidy_old
  # Each file is written beside its place and then moved into it, so a
  # connector that's running right now finishes with the file it started.
  cat >"$host_file.new" <<'SPINE_HOST'
__SPINE_HOST_SH__
SPINE_HOST
  chmod 755 "$host_file.new"
  mv -f "$host_file.new" "$host_file"
  {
    printf '#!%s\n' "$BASH"
    printf '# Starts Spine'"'"'s connector with the tools the installer found.\n'
    if [ -n "$CLAUDE" ]; then printf 'export CLAUDE_BIN=%q\n' "$CLAUDE"; fi
    if [ -n "$CODEX" ]; then printf 'export CODEX_BIN=%q\n' "$CODEX"; fi
    printf 'exec %q %q "$@"\n' "$BASH" "$host_file"
  } >"$wrapper.new"
  chmod 755 "$wrapper.new"
  mv -f "$wrapper.new" "$wrapper"

  for id in "${IDS[@]}"; do origins="$origins${origins:+, }\"chrome-extension://$id/\""; done
  manifest="{
  \"name\": \"$NAME\",
  \"description\": \"Spine: read with Claude Code or Codex on this computer\",
  \"path\": \"$wrapper\",
  \"type\": \"stdio\",
  \"allowed_origins\": [$origins]
}"
  CONNECTED=()
  for browser in "${BROWSERS[@]}"; do
    [ -d "$DATA/$browser" ] || continue
    mkdir -p "$DATA/$browser/NativeMessagingHosts"
    printf '%s\n' "$manifest" >"$DATA/$browser/NativeMessagingHosts/$NAME.json.new"
    mv -f "$DATA/$browser/NativeMessagingHosts/$NAME.json.new" "$DATA/$browser/NativeMessagingHosts/$NAME.json"
    CONNECTED+=("$(browser_name "$browser")")
  done
  [ ${#CONNECTED[@]} -gt 0 ] || fail "no supported browser found. Spine works in Chrome, Arc, Brave, Edge, Vivaldi, Dia and Aside."
}

joined() {
  local list="" last="" item
  for item in "$@"; do
    if [ -n "$last" ]; then list="$list${list:+, }$last"; fi
    last="$item"
  done
  if [ -n "$list" ]; then printf '%s and %s' "$list" "$last"; else printf '%s' "$last"; fi
}

main() {
  setup_paths
  for arg in "$@"; do
    case "$arg" in
      --uninstall)
        uninstall
        return
        ;;
      --yes | -y) YES=1 ;;
    esac
  done

  say "${bold}Connecting Spine to your Claude plan${plain}"
  CLAUDE="$(find_tool claude)"
  CODEX="$(find_tool codex)"

  if [ -z "$CLAUDE" ]; then
    say "Spine reads through Claude Code, Anthropic's app for your Claude Pro or Max plan. It isn't on this computer yet."
    if ask "Install Claude Code now?"; then
      install_claude || true
    elif [ "$TTY" = 0 ] && [ "$YES" = 0 ]; then
      say "To install it, run: curl -fsSL https://claude.ai/install.sh | bash"
    fi
  fi

  if [ -n "$CLAUDE" ] && ! claude_signed_in; then
    if [ "$TTY" = 1 ] || [ "$YES" = 1 ]; then
      sign_in_claude || say "Claude Code isn't signed in yet. Run this command again to sign in."
    else
      say "Claude Code isn't signed in. Run this command again in Terminal to sign in."
    fi
  fi

  step "Connecting Spine"
  install_connector

  local ready="" browsers
  browsers="$(joined "${CONNECTED[@]}")"
  if [ -n "$CLAUDE" ] && claude_signed_in; then
    ready="Claude Code $("$CLAUDE" --version </dev/null 2>/dev/null | head -1 | awk '{print $1}')"
  fi
  if [ -n "$CODEX" ] && "$CODEX" login status </dev/null >/dev/null 2>&1; then
    ready="$(joined ${ready:+"$ready"} "Codex $("$CODEX" --version </dev/null 2>/dev/null | head -1 | awk '{print $NF}')")"
  fi
  if [ -n "$ready" ]; then
    say "Spine is connected to $ready in $browsers."
    say ""
    say "${bold}Go back to Spine: it starts reading by itself.${plain}"
    say "${dim}On another article, press Option-Shift-S (Alt-Shift-S) to open Spine.${plain}"
  else
    say "Spine's connector is installed in $browsers, but Claude Code isn't ready yet."
    say "Run this command again to install Claude Code or sign in."
  fi
}

main "$@"
