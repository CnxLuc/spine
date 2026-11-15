// Claude Code and Codex on the reader's computer, through Spine's connector
// (native/spine-host.sh), which the reader adds with one command. The browser
// starts the connector for each connection and only lets Spine in. The
// connector runs the reader's own, unmodified `claude -p` or `codex exec` and
// passes on what they print, line by line; this file makes sense of it, so the
// connector itself can stay a few lines of shell that need nothing installed.

export const HOST = 'com.spine.local';
// The connector's protocol. An older connector answers in a way Spine can't
// use, and the reader runs the command again to update it.
export const PROTOCOL = 3;
export const TOOLS = { 'claude-code': 'claude', codex: 'codex' };
export const NAMES = { 'claude-code': 'Claude Code', codex: 'Codex' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(text) {
  const bytes = encoder.encode(text);
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64(text) {
  if (!text) return '';
  try {
    return decoder.decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
  } catch {
    return '';
  }
}

/* What Spine asks the connector */

export const PING = 'ping';

// One reading. Every field travels in base64url, so the request is a plain
// string the connector can split without parsing JSON. Codex has no separate
// system prompt, so its instructions lead the input.
export function runRequest({ engine, model = '', effort = 'medium', system = '', schema = null, user = '' }) {
  const codex = engine === 'codex';
  const input = codex
    ? `${system}\n\nAnswer with the JSON only. Don't run commands or read files: everything you need is below.\n\n${user}`
    : user;
  const fields = [TOOLS[engine], codex ? '' : model, effort, codex ? '' : system, schema ? JSON.stringify(schema) : '', input];
  return ['run', ...fields.map(base64url)].join('.');
}

/* What's on this computer */

const firstLine = text => text.trim().split('\n')[0]?.trim() ?? '';
const versionOf = text => text.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? '';

const PLANS = { pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise' };

function claudeOf(raw) {
  if (!raw) return null;
  const said = fromBase64(raw.status);
  let status = {};
  try {
    status = JSON.parse(said.slice(said.indexOf('{'), said.lastIndexOf('}') + 1));
  } catch {
    // Not the JSON Claude Code prints today, or a warning in the middle of
    // it: read the words instead.
    status = { loggedIn: /"loggedIn"\s*:\s*true/.test(said) || (/logged in/i.test(said) && !/not logged in/i.test(said)) };
  }
  const subscription = String(status.subscriptionType ?? '').toLowerCase();
  const onPlan = status.authMethod === 'claude.ai' || Boolean(subscription);
  const version = fromBase64(raw.version);
  return {
    path: fromBase64(raw.path),
    version: versionOf(version) ? `Claude Code ${versionOf(version)}` : firstLine(version) || 'Claude Code',
    signedIn: status.loggedIn === true,
    // The plan reading counts toward: a Claude plan, or API credits when
    // Claude Code signed in with a Console account or an API key.
    plan: onPlan ? PLANS[subscription] ?? 'Claude' : 'API',
  };
}

function codexOf(raw) {
  if (!raw) return null;
  const said = fromBase64(raw.status).toLowerCase();
  const version = fromBase64(raw.version);
  return {
    path: fromBase64(raw.path),
    version: versionOf(version) ? `Codex ${versionOf(version)}` : firstLine(version) || 'Codex',
    signedIn: raw.code === 0 && said.includes('logged in') && !said.includes('not logged in'),
    plan: said.includes('api key') ? 'API' : 'ChatGPT',
  };
}

// The connector's answer to a ping, or why there wasn't one.
export function describe(reply) {
  if (reply?.type !== 'pong' || !(Number(reply.host) >= PROTOCOL)) return { available: true, outdated: true, claude: null, codex: null };
  return { available: true, outdated: false, claude: claudeOf(reply.claude), codex: codexOf(reply.codex) };
}

// Why the browser couldn't reach the connector, from its error message.
export function unreachable(message = '') {
  if (/not found/i.test(message)) return 'not-installed';
  // The connector is there, but for another copy of Spine: the downloaded one
  // or the Chrome Web Store one.
  if (/forbidden/i.test(message)) return 'forbidden';
  return 'closed';
}

/* Making sense of a reading */

// A failure the reader can act on, from what the tool said.
function explain(text, name) {
  const said = String(text ?? '').trim();
  if (/usage limit|rate.?limit|limit reached|out of (extra )?usage|credit balance/i.test(said)) {
    return { code: 'limit', message: 'Your plan has reached its usage limit for now. Try again later.' };
  }
  if (/log ?in|logged out|not logged|authenticat|sign.?in|oauth|401/i.test(said)) {
    return { code: 'local-setup', message: `${name} isn’t signed in.` };
  }
  return { code: 'local', message: said.slice(0, 400) || `${name} couldn’t read this article.` };
}

function ended({ code, stderr, missing }, name) {
  if (missing) return { type: 'error', code: 'local-setup', message: `${name} isn’t installed on this computer.` };
  return { type: 'error', ...explain(fromBase64(stderr) || `${name} stopped with code ${code}.`, name) };
}

// Claude Code's stream-json. With a schema, Claude answers through a
// StructuredOutput tool whose input streams as JSON; a second try starts over.
// The reading ends with Claude Code's result line, not when it exits: it has
// been known to linger after answering, and Spine going away stops it.
export function claudeReading() {
  let json = '';
  let plain = '';
  let inTool = false;
  let result = null;
  return message => {
    const out = [];
    if (message?.type === 'stream_event') {
      const event = message.event ?? {};
      if (event.type === 'content_block_start') {
        inTool = event.content_block?.type === 'tool_use';
        if (inTool && json) {
          json = '';
          out.push({ type: 'restart' });
        }
      } else if (event.type === 'content_block_stop') {
        inTool = false;
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta ?? {};
        if (inTool && delta.type === 'input_json_delta' && delta.partial_json) {
          json += delta.partial_json;
          out.push({ type: 'delta', text: delta.partial_json });
        } else if (delta.type === 'text_delta') {
          plain += delta.text ?? '';
        }
      }
    } else if (message?.type === 'result' && !result) {
      result = message;
      if (!result.is_error) {
        const text = result.structured_output != null ? JSON.stringify(result.structured_output) : json || plain;
        out.push({ type: 'done', text, usage: result.usage ?? {} });
      } else {
        const said = [result.result, ...(result.errors ?? [])].filter(Boolean).join(' ');
        out.push({ type: 'error', ...explain(said || `Claude Code stopped with an error (${result.subtype || 'unknown'}).`, 'Claude Code') });
      }
    } else if (message?.type === 'exit' && !result) {
      out.push(ended(message, 'Claude Code'));
    }
    return out;
  };
}

// Codex's JSON events: it answers all at once, as its last message. It also
// reports errors it recovers from, such as reconnecting, so only a turn that
// didn't complete counts as failed.
export function codexReading() {
  let answer = '';
  let usage = {};
  let failure = '';
  let completed = false;
  let finished = false;
  return message => {
    if (finished) return [];
    const kind = message?.type;
    if (kind === 'item.completed' && message.item?.type === 'agent_message') answer = message.item.text ?? '';
    else if (kind === 'turn.completed') {
      completed = true;
      usage = message.usage ?? {};
      // The answer is in: done, without waiting for Codex to exit.
      if (answer) {
        finished = true;
        return [{ type: 'delta', text: answer }, { type: 'done', text: answer, usage }];
      }
    } else if (kind === 'turn.failed') {
      completed = false;
      failure = message.error?.message || failure || 'Codex couldn’t finish.';
    } else if (kind === 'error') failure = message.message || failure;
    else if (kind === 'exit') {
      if (answer && completed) return [{ type: 'delta', text: answer }, { type: 'done', text: answer, usage }];
      if (failure) return [{ type: 'error', ...explain(failure, 'Codex') }];
      return [ended(message, 'Codex')];
    }
    return [];
  };
}
