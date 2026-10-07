// A local stand-in for Anthropic's Messages API, backed by Claude Code.
//
// Spine talks to Claude through the official SDK. Pointing Spine's "API
// address" setting at this bridge sends those same requests to `claude -p` on
// this Mac instead, so Spine runs on a Claude subscription with no API key. It
// is also how Spine's tests exercise the real streaming path.
//
//   node tools/claude-bridge.mjs [port]        (default 4777)
//
// It answers POST /v1/messages for requests with a JSON schema, streamed or not,
// and nothing else. It listens on 127.0.0.1 only, answers only browser
// extensions (never web pages), and only with the secret in
// ~/.config/spine/bridge-token, which goes in Spine's settings as the API key.
// Without both, a web page you visit could spend your Claude plan.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4777);
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
// Only browser extensions may call: web pages can't send these origins. The
// token is what limits it to Spine. SPINE_ORIGINS narrows it to listed ids.
const ORIGINS = process.env.SPINE_ORIGINS?.split(',') ?? null;
const allowed = origin => (ORIGINS ? ORIGINS.includes(origin) : /^chrome-extension:\/\/[a-p]{32}$/.test(origin));

function secret() {
  const dir = join(homedir(), '.config', 'spine');
  const file = join(dir, 'bridge-token');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const token = `spine-${randomBytes(24).toString('base64url')}`;
    writeFileSync(file, `${token}\n`, { mode: 0o600 });
    return token;
  }
}
const TOKEN = secret();
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const corsFor = origin => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true',
  Vary: 'Origin',
});

const textOf = content =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

function run(body, onDelta, signal) {
  const system = textOf(body.system);
  const user = textOf(body.messages?.filter(m => m.role === 'user').at(-1)?.content);
  const schema = body.output_config?.format?.schema;
  const args = [
    '-p',
    '--model', body.model ?? 'claude-opus-5-5',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--effort', body.output_config?.effort ?? 'medium',
  ];
  if (system) args.push('--system-prompt', system);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    signal.addEventListener('abort', () => child.kill('SIGTERM'));
    child.stdin.end(user);
    let buffer = '';
    let json = '';
    let text = '';
    let inTool = false;
    let result = null;
    let stderr = '';
    child.stderr.on('data', chunk => (stderr += chunk));
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type === 'content_block_start') inTool = event.content_block?.type === 'tool_use';
          else if (event.type === 'content_block_stop') inTool = false;
          else if (event.type === 'content_block_delta') {
            if (inTool && event.delta?.type === 'input_json_delta') {
              json += event.delta.partial_json;
              onDelta(event.delta.partial_json);
            } else if (event.delta?.type === 'text_delta') text += event.delta.text;
          }
        } else if (message.type === 'result') result = message;
      }
    });
    child.on('close', code => {
      if (signal.aborted) return reject(new Error('aborted'));
      if (!result || result.is_error) {
        return reject(new Error(result?.result || stderr.trim() || `claude exited with ${code}`));
      }
      resolve({ text: json || (result.structured_output ? JSON.stringify(result.structured_output) : text), usage: result.usage });
    });
  });
}

const sse = (response, type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

createServer(async (request, response) => {
  // Only Spine may call, and only with the secret.
  const origin = request.headers.origin ?? '';
  if (!allowed(origin)) {
    response.writeHead(403, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ type: 'error', error: { type: 'permission_error', message: 'Only Spine can use this bridge.' } }));
  }
  const cors = corsFor(origin);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors);
    return response.end();
  }
  const key = String(request.headers['x-api-key'] ?? '');
  if (!same(key, TOKEN)) {
    response.writeHead(401, { ...cors, 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Put the token from ~/.config/spine/bridge-token in Spine’s API key field.' } }));
  }
  const path = new URL(request.url, 'http://localhost').pathname;
  if (request.method !== 'POST' || path !== '/v1/messages') {
    response.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'Only POST /v1/messages is bridged.' } }));
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    response.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Bad JSON.' } }));
  }
  const controller = new AbortController();
  response.on('close', () => {
    if (!response.writableFinished) controller.abort();
  });
  const id = `msg_bridge_${Date.now().toString(36)}`;
  const kind = textOf(body.system).slice(0, 48).replace(/\s+/g, ' ');
  const started = Date.now();
  console.log(`→ ${body.model} · ${raw.length.toLocaleString()} bytes · ${kind}…`);
  const message = { id, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } };
  if (body.stream) {
    response.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    sse(response, 'message_start', { message });
    sse(response, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    const ping = setInterval(() => sse(response, 'ping', {}), 10000);
    try {
      const { usage } = await run(body, text => sse(response, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text } }), controller.signal);
      clearInterval(ping);
      sse(response, 'content_block_stop', { index: 0 });
      sse(response, 'message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage?.output_tokens ?? 0 } });
      sse(response, 'message_stop', {});
      console.log(`← done in ${((Date.now() - started) / 1000).toFixed(1)}s · ${usage?.output_tokens ?? '?'} tokens out`);
    } catch (error) {
      clearInterval(ping);
      if (!controller.signal.aborted) {
        sse(response, 'error', { error: { type: 'api_error', message: error.message } });
        console.log(`✗ ${error.message}`);
      } else console.log('✗ stopped by the reader');
    }
    return response.end();
  }
  try {
    const { text, usage } = await run(body, () => {}, controller.signal);
    response.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0 } }));
    console.log(`← done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    if (controller.signal.aborted) return;
    response.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: error.message } }));
  }
}).listen(PORT, '127.0.0.1', () =>
  console.log(`Claude bridge on http://127.0.0.1:${PORT} (using ${CLAUDE}); its key is in ~/.config/spine/bridge-token`),
);
