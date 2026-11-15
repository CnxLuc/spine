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
IDS=(hbaekihlobpbmhciebgibgeljinadcib)
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
#!/bin/bash
# Spine's connector: lets the Spine extension ask Claude Code or Codex on this
# computer to read an article, so the reading runs on the reader's own Claude
# or ChatGPT plan.
#
# Your browser starts this script when Spine asks for a reading, and only
# Spine can: the browser checks the extension's id against the list in the
# connector's manifest. Each connection carries one request. The script runs
# your own, unmodified `claude -p` or `codex exec`, signed in as you, passes
# on what it prints, and exits. It never reads or stores your sign-in.
#
# It needs only bash and tools every Mac and Linux computer has: no Python,
# no Node. Spine itself makes sense of what Claude Code or Codex prints.
#
# Every message is framed by a 4-byte length in native byte order, as Chrome's
# native messaging defines. Version 3 of the protocol:
#
#   in   "ping"
#   out  {"type":"pong","host":3,"claude":TOOL,"codex":TOOL}
#        TOOL is null when the tool isn't installed. Otherwise it gives the
#        tool's path, what `--version` printed, and what its sign-in check
#        printed, each in base64, and the check's exit code:
#        {"path":"…","version":"…","status":"…","code":0}
#
#   in   "run.ENGINE.MODEL.EFFORT.SYSTEM.SCHEMA.INPUT"
#        Each field is in base64url. ENGINE is claude or codex. INPUT, the
#        article, goes straight to the tool's standard input.
#   out  Each line the tool prints, as it prints it: Claude Code's stream-json
#        or Codex's JSON events.
#   out  {"type":"exit","code":0,"stderr":"…"}, with the end of the tool's
#        error output in base64. "missing":true means the tool isn't installed.
#
#   out  {"type":"refused","code":"…","message":"…"} for a request it can't take.

set -u -f
export LC_ALL=C # lengths in bytes, and plain bytes through every tool

HOST_VERSION=3
here=$(cd "$(dirname "$0")" && pwd -P)
work="$here/work"

# Where Claude Code and Codex usually live, for browsers that start this
# script with a short PATH. The installer may also give their paths as
# CLAUDE_BIN and CODEX_BIN.
HOME=${HOME-}
SEARCH=${SPINE_SEARCH-"$HOME/.local/bin:$HOME/.claude/local:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin"}

if printf 'YQ==' | base64 -d >/dev/null 2>&1; then decode=-d; else decode=-D; fi
if [ "$(printf '\001\000\000\000' | od -An -tu4 | tr -d ' \n')" = 1 ]; then little=1; else little=0; fi

# Sends one message: a JSON value on one line.
frame() {
  local n=${#1} head
  if [ $little = 1 ]; then
    printf -v head '\\%03o\\%03o\\%03o\\%03o' $((n & 255)) $((n >> 8 & 255)) $((n >> 16 & 255)) $((n >> 24 & 255))
  else
    printf -v head '\\%03o\\%03o\\%03o\\%03o' $((n >> 24 & 255)) $((n >> 16 & 255)) $((n >> 8 & 255)) $((n & 255))
  fi
  printf "$head%s" "$1"
}

base64_of() { printf '%s' "$1" | base64 | tr -d '\n'; }

# A request field: base64url in, the bytes it stands for out.
field() {
  local text
  text=$(printf '%s' "$1" | tr '_-' '/+')
  case $((${#text} % 4)) in
    2) text="$text==" ;;
    3) text="$text=" ;;
  esac
  printf '%s' "$text" | base64 $decode 2>/dev/null
}

refuse() {
  frame "{\"type\":\"refused\",\"code\":\"$1\",\"message\":\"$2\"}"
  exit 0
}

# The path to claude or codex: the one the installer found, or the first in
# the usual places.
find_tool() {
  local name=$1 given dir IFS=:
  if [ "$name" = claude ]; then given=${CLAUDE_BIN-}; else given=${CODEX_BIN-}; fi
  if [ -n "$given" ] && [ -x "$given" ] && [ ! -d "$given" ]; then
    printf '%s' "$given"
    return 0
  fi
  for dir in $PATH $SEARCH; do
    if [ -n "$dir" ] && [ -x "$dir/$name" ] && [ ! -d "$dir/$name" ]; then
      printf '%s' "$dir/$name"
      return 0
    fi
  done
  return 1
}

# Runs a tool in the quiet folder, with the tool's own folder first on the
# PATH: one installed with npm needs the node beside it.
start() {
  local bin=$1
  shift
  trap - PIPE
  cd "$work" && exec env PATH="$(dirname "$bin"):$SEARCH:$PATH" "$bin" "$@"
}

# Runs a short command with no input, for at most 15 seconds. Sets said to
# what it printed and code to its exit code.
quietly() {
  local out="$tmp/said" pid dog
  (start "$@") 3<&- </dev/null >"$out" 2>&1 &
  pid=$!
  (
    i=0
    while [ $i -lt 150 ] && kill -0 "$pid" 2>/dev/null; do
      sleep 0.1
      i=$((i + 1))
    done
    kill "$pid" 2>/dev/null
  ) >/dev/null 2>&1 &
  dog=$!
  wait "$pid"
  code=$?
  kill "$dog" 2>/dev/null
  said=$(head -c 4000 "$out")
  rm -f "$out"
}

describe() {
  local name=$1 bin version
  if ! bin=$(find_tool "$name"); then
    printf null
    return
  fi
  quietly "$bin" --version
  version=$said
  if [ "$name" = claude ]; then quietly "$bin" auth status; else quietly "$bin" login status; fi
  printf '{"path":"%s","version":"%s","status":"%s","code":%d}' \
    "$(base64_of "$bin")" "$(base64_of "$version")" "$(base64_of "$said")" "$code"
}

# Passes on each line the tool prints. A line too long for the browser to
# take (1 MB) is only counted.
relay() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      '{'*'}')
        if [ ${#line} -lt 1000000 ]; then frame "$line"; else frame "{\"type\":\"skipped\",\"bytes\":${#line}}"; fi
        ;;
    esac
  done
}

run() {
  local engine model effort system schema input=${6-} bin
  engine=$(field "${1-}")
  model=$(field "${2-}")
  effort=$(field "${3-}")
  case $engine in claude | codex) ;; *) refuse request "Unknown engine." ;; esac
  case $model in *[!A-Za-z0-9._:-]*) refuse request "Unknown model." ;; esac
  case $effort in '' | low | medium | high | xhigh | max) ;; *) refuse request "Unknown effort." ;; esac
  if ! bin=$(find_tool "$engine"); then
    frame '{"type":"exit","code":127,"missing":true,"stderr":""}'
    return
  fi
  system=$(field "${4-}")
  schema=$(field "${5-}")

  if [ "$engine" = claude ]; then
    set -- -p --model "${model:-claude-opus-5-5}" \
      --output-format stream-json --include-partial-messages --verbose \
      --tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands \
      --no-session-persistence --effort "${effort:-medium}"
    if [ -n "$system" ]; then set -- "$@" --system-prompt "$system"; fi
    if [ -n "$schema" ]; then set -- "$@" --json-schema "$schema"; fi
  else
    # Your own Codex settings are for coding; Spine wants your plan's default
    # model and nothing else. The sign-in still comes from your Codex.
    # Codex's read-only sandbox still lets it run commands that read any
    # file, and an article could ask it to. Without its shell, it can't.
    set -- exec --json --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules \
      --sandbox read-only -c features.shell_tool=false -c "model_reasoning_effort=\"${effort:-medium}\"" -C "$work"
    if [ -n "$schema" ]; then
      printf '%s' "$schema" >"$tmp/schema.json"
      set -- "$@" --output-schema "$tmp/schema.json"
    fi
    set -- "$@" -
  fi

  mkfifo "$tmp/out"
  # The article goes straight to the tool's input: it's never written down.
  field "$input" | (start "$bin" "$@") 3<&- >"$tmp/out" 2>"$tmp/err" &
  child=$!
  # When Spine goes away, the browser closes this script's input: stop the
  # tool too, so it doesn't use your plan for nothing.
  (
    cat <&3 >/dev/null
    kill "$child" 2>/dev/null
  ) >/dev/null 2>&1 &
  relay <"$tmp/out"
  wait "$child"
  local code=$?
  child=
  frame "{\"type\":\"exit\",\"code\":$code,\"stderr\":\"$(tail -c 2000 "$tmp/err" | base64 | tr -d '\n')\"}"
}

main() {
  mkdir -p "$work"
  # Anything an earlier run couldn't clear away.
  find "$work" -maxdepth 1 -name 'run.*' -mtime +1 -exec rm -rf {} + 2>/dev/null
  tmp=$(mktemp -d "$work/run.XXXXXX")
  child=
  trap 'rm -rf "$tmp"' EXIT
  trap '[ -n "$child" ] && kill "$child" 2>/dev/null; exit 143' TERM INT HUP
  # The browser may stop listening first; finish quietly, and tidy up.
  trap '' PIPE

  # The browser's end of the conversation, kept apart: a job in the
  # background would otherwise read nothing at all.
  exec 3<&0

  # One request: a JSON string of fields with nothing in them to escape.
  local size request
  size=$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' \n')
  case $size in '' | *[!0-9]*) return 0 ;; esac
  request=$(head -c "$size")
  case $request in
    '{"type":"ping"}')
      # Spine 1.2 and earlier spoke JSON to a connector written in Python.
      # Answer its ping the way it understands, so it tries a reading and
      # hears that it needs updating, rather than "not connected" for ever.
      frame '{"type":"pong","host":"2","claude":{"path":"","version":"Spine needs updating","signedIn":true,"plan":""},"codex":null}'
      return 0
      ;;
    '{'*)
      frame '{"type":"error","code":"update","message":"Spine needs updating to use this connector. Download the latest Spine from cnxluc.github.io/spine."}'
      return 0
      ;;
  esac
  request=${request#\"}
  request=${request%\"}
  IFS=.
  set -- $request
  unset IFS
  case ${1-} in
    ping) frame "{\"type\":\"pong\",\"host\":$HOST_VERSION,\"claude\":$(describe claude),\"codex\":$(describe codex)}" ;;
    run)
      shift
      run "$@"
      ;;
    *) refuse request "Unknown request." ;;
  esac
}

# Bash reads a script as it runs it. Running main, and exiting, from one last
# line means the whole file is read first, so an update can't change it
# mid-run.
main "$@"; exit
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
