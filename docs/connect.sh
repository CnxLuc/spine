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
IDS=(hbaekihlobpbmhciebgibgeljinadcib)
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
#!/usr/bin/env python3
"""Spine's native messaging host: lets the Spine extension ask Claude Code or
Codex on this computer to read an article, so the reading runs on the reader's
own Claude or ChatGPT plan.

The browser starts this program when Spine connects to it, and only Spine can:
the browser checks the extension's id against the list in this host's
manifest. Each connection carries one request. The program runs the reader's
own, unmodified `claude -p` or `codex exec`, signed in by the reader, streams
the reply back, and exits. It never reads or stores anyone's credentials.

Messages, each a JSON object framed by a 4-byte length, as Chrome's native
messaging defines:

  in   {"type": "ping"}
  out  {"type": "pong", "host": "2",
        "claude": {"path": "...", "version": "...", "signedIn": true, "plan": "claude.ai"} or null,
        "codex": {"path": "...", "version": "...", "signedIn": true, "plan": "ChatGPT"} or null}

  in   {"type": "run", "engine": "claude" or "codex", "model": "...", "system": "...",
        "user": "...", "schema": {...}, "effort": "medium"}
  out  {"type": "delta", "text": "..."}   (any number, as the reply streams)
  out  {"type": "done", "text": "...", "usage": {...}}
   or  {"type": "error", "code": "...", "message": "..."}

Works with the Python 3 that ships with macOS (3.9) and on Linux.
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading

HOST_VERSION = "2"
# Where Claude Code and Codex usually live, for browsers that start this
# program with a short PATH.
COMMON_PATHS = [
    "~/.local/bin",
    "~/.claude/local",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "~/.npm-global/bin",
    "~/.bun/bin",
    "/usr/bin",
]

out = sys.stdout.buffer
out_lock = threading.Lock()


def send(message):
    data = json.dumps(message).encode("utf-8")
    with out_lock:
        out.write(struct.pack("@I", len(data)))
        out.write(data)
        out.flush()


def receive():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("@I", header)
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def find(tool):
    """The path to `claude` or `codex`: from the installer, or the usual places."""
    found = os.environ.get(tool.upper() + "_BIN")
    if found:
        return found if os.access(found, os.X_OK) else None
    path = os.environ.get("PATH", "") + os.pathsep + os.pathsep.join(os.path.expanduser(p) for p in COMMON_PATHS)
    return shutil.which(tool, path=path)


def environment(binary):
    env = dict(os.environ)
    extra = [os.path.dirname(binary)] + [os.path.expanduser(p) for p in COMMON_PATHS]
    env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    return env


def quietly(args, binary):
    """Runs a short command, without the browser's message pipe as its input."""
    try:
        done = subprocess.run(
            args, capture_output=True, text=True, timeout=15, env=environment(binary), stdin=subprocess.DEVNULL
        )
        return done.returncode, (done.stdout or "") + (done.stderr or "")
    except Exception:
        return 1, ""


def work_directory():
    # A quiet folder to run in, so nothing lands wherever the browser started us.
    folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work")
    os.makedirs(folder, exist_ok=True)
    return folder


def describe_claude():
    claude = find("claude")
    if not claude:
        return None
    _, version = quietly([claude, "--version"], claude)
    _, raw = quietly([claude, "auth", "status"], claude)
    try:
        status = json.loads(raw[raw.index("{"):])
    except ValueError:
        status = {}
    return {
        "path": claude,
        "version": version.strip().splitlines()[0] if version.strip() else "",
        "signedIn": bool(status.get("loggedIn")),
        "plan": status.get("authMethod") or "",
    }


def describe_codex():
    codex = find("codex")
    if not codex:
        return None
    _, version = quietly([codex, "--version"], codex)
    code, status = quietly([codex, "login", "status"], codex)
    lowered = status.lower()
    signed_in = code == 0 and "logged in" in lowered and "not logged in" not in lowered
    return {
        "path": codex,
        "version": version.strip().splitlines()[0] if version.strip() else "",
        "signedIn": signed_in,
        "plan": "ChatGPT" if "chatgpt" in lowered else ("API key" if "api key" in lowered else ""),
    }


def ping():
    send({"type": "pong", "host": HOST_VERSION, "claude": describe_claude(), "codex": describe_codex()})


def explain(text):
    """A failure the reader can act on."""
    lowered = (text or "").lower()
    if "usage limit" in lowered or "rate limit" in lowered:
        return "limit", "Your plan has reached its usage limit for now. Try again later."
    if "log in" in lowered or "login" in lowered or "not logged" in lowered or "authenticat" in lowered:
        return "login", "It isn't signed in. Run it in Terminal and sign in, then try again."
    return "local", (text or "It couldn't read this article.").strip()[:400]


def watch_for_goodbye(child):
    """When Spine goes away, the browser closes our input: stop the child too."""

    def watch():
        while True:
            if receive() is None:
                try:
                    child.kill()
                finally:
                    os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def run(request):
    if request.get("engine") == "codex":
        run_codex(request)
    else:
        run_claude(request)


def run_claude(request):
    claude = find("claude")
    if not claude:
        send({"type": "error", "code": "missing", "message": "Claude Code isn't installed on this computer."})
        return
    args = [
        claude, "-p",
        "--model", str(request.get("model") or "claude-opus-5-5"),
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--effort", str(request.get("effort") or "medium"),
    ]
    if request.get("system"):
        args += ["--system-prompt", request["system"]]
    if request.get("schema"):
        args += ["--json-schema", json.dumps(request["schema"])]

    child = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=environment(claude),
        cwd=work_directory(),
    )

    watch_for_goodbye(child)

    child.stdin.write((request.get("user") or "").encode("utf-8"))
    child.stdin.close()

    json_text = ""
    plain_text = ""
    in_tool = False
    result = None
    for raw in child.stdout:
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        kind = message.get("type")
        if kind == "stream_event":
            event = message.get("event") or {}
            event_type = event.get("type")
            if event_type == "content_block_start":
                in_tool = (event.get("content_block") or {}).get("type") == "tool_use"
            elif event_type == "content_block_stop":
                in_tool = False
            elif event_type == "content_block_delta":
                delta = event.get("delta") or {}
                if in_tool and delta.get("type") == "input_json_delta":
                    json_text += delta.get("partial_json", "")
                    send({"type": "delta", "text": delta.get("partial_json", "")})
                elif delta.get("type") == "text_delta":
                    plain_text += delta.get("text", "")
        elif kind == "result":
            result = message
    child.wait()
    stderr = child.stderr.read().decode("utf-8", "replace")

    if not result or result.get("is_error"):
        code, text = explain((result or {}).get("result") or stderr or "Claude Code stopped with code %s." % child.returncode)
        send({"type": "error", "code": code, "message": text})
        return
    text = json_text
    if not text and result.get("structured_output") is not None:
        text = json.dumps(result["structured_output"])
    send({"type": "done", "text": text or plain_text, "usage": result.get("usage") or {}})


def run_codex(request):
    codex = find("codex")
    if not codex:
        send({"type": "error", "code": "missing", "message": "Codex isn't installed on this computer."})
        return
    work = work_directory()
    schema_file = None
    args = [
        codex, "exec",
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        # The reader's own Codex settings are for coding; Spine wants the plan's
        # default model and nothing else. Sign-in still comes from their Codex.
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox", "read-only",
        "-c", 'model_reasoning_effort="%s"' % (request.get("effort") or "medium"),
        "-C", work,
    ]
    if request.get("schema"):
        handle, schema_file = tempfile.mkstemp(prefix="spine-", suffix=".json", dir=work)
        with os.fdopen(handle, "w") as written:
            json.dump(request["schema"], written)
        args += ["--output-schema", schema_file]
    args.append("-")
    # Codex has no separate system prompt, so the instructions lead the prompt.
    prompt = "%s\n\nAnswer with the JSON only. Don't run commands or read files: everything you need is below.\n\n%s" % (
        request.get("system") or "",
        request.get("user") or "",
    )
    child = subprocess.Popen(
        args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment(codex), cwd=work
    )
    watch_for_goodbye(child)
    child.stdin.write(prompt.encode("utf-8"))
    child.stdin.close()

    answer = ""
    usage = {}
    failure = ""
    for raw in child.stdout:
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        kind = event.get("type")
        item = event.get("item") or {}
        if kind == "item.completed" and item.get("type") == "agent_message":
            answer = item.get("text") or ""
        elif kind == "turn.completed":
            usage = event.get("usage") or {}
        elif kind == "turn.failed":
            failure = (event.get("error") or {}).get("message") or failure
        elif kind == "error":
            failure = event.get("message") or failure
    child.wait()
    stderr = child.stderr.read().decode("utf-8", "replace")
    if schema_file:
        try:
            os.remove(schema_file)
        except OSError:
            pass
    if failure or not answer:
        code, text = explain(failure or stderr or "Codex stopped with code %s." % child.returncode)
        send({"type": "error", "code": code, "message": text})
        return
    # Codex answers all at once; send it as one piece, then the whole.
    send({"type": "delta", "text": answer})
    send({"type": "done", "text": answer, "usage": usage})


def main():
    request = receive()
    if not request:
        return
    if request.get("type") == "ping":
        ping()
    elif request.get("type") == "run":
        run(request)
    else:
        send({"type": "error", "code": "request", "message": "Unknown request."})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # Never leave Spine waiting.
        send({"type": "error", "code": "host", "message": str(error)[:400]})
    finally:
        # The goodbye watcher may still be reading our input. A normal exit
        # can't close it and Python aborts with a crash report. Every reply is
        # already flushed, so leave at once.
        os._exit(0)
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
