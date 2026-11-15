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
