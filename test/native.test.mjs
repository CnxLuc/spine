// The native host, driven the way the browser drives it, against a fake
// `claude` so nothing is sent to Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const HOST = resolve('native/spine_host.py');
const FAKE = resolve('test/fixtures/fake-claude');
const FAKE_CODEX = resolve('test/fixtures/fake-codex');

// Sends one framed message and collects every framed reply until the host exits.
function talk(message, env = {}) {
  return new Promise((done, fail) => {
    const child = spawn('python3', [HOST], { env: { ...process.env, CLAUDE_BIN: FAKE, CODEX_BIN: FAKE_CODEX, ...env } });
    const replies = [];
    let buffer = Buffer.alloc(0);
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        replies.push(JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')));
        buffer = buffer.subarray(4 + length);
      }
    });
    child.on('error', fail);
    child.on('exit', () => done(replies));
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
    // The browser keeps the pipe open while it listens; closing it ends a run.
    if (message.type === 'ping') child.stdin.end();
    else setTimeout(() => child.stdin.end(), 3000);
  });
}

test('a ping finds Claude Code and Codex, and their sign-ins', async () => {
  const [pong] = await talk({ type: 'ping' });
  assert.equal(pong.type, 'pong');
  assert.deepEqual(pong.claude, { path: FAKE, version: '9.9.9 (Claude Code)', signedIn: true, plan: 'claude.ai' });
  assert.deepEqual(pong.codex, { path: FAKE_CODEX, version: 'codex-cli 9.9.9', signedIn: true, plan: 'ChatGPT' });
});

test('a ping says which tool is signed out, or missing', async () => {
  const [pong] = await talk({ type: 'ping' }, { FAKE_CLAUDE_LOGGED_OUT: '1', FAKE_CODEX_LOGGED_OUT: '1' });
  assert.equal(pong.claude.signedIn, false);
  assert.equal(pong.codex.signedIn, false);
  const [missing] = await talk({ type: 'ping' }, { CODEX_BIN: '/nonexistent' });
  assert.equal(missing.codex, null);
  assert.equal(missing.claude.signedIn, true);
});

test('a run streams the reply and ends with all of it', async () => {
  const replies = await talk({
    type: 'run',
    model: 'claude-opus-5-5',
    system: 'Be brief.',
    user: 'The article text goes here, sentence by sentence.',
    schema: { type: 'object', properties: { keySentences: {}, sections: {} } },
  });
  const deltas = replies.filter(reply => reply.type === 'delta');
  const done = replies.at(-1);
  assert.ok(deltas.length > 3, 'it should stream');
  assert.equal(done.type, 'done');
  assert.equal(deltas.map(delta => delta.text).join(''), done.text);
  const parsed = JSON.parse(done.text);
  assert.equal(parsed.echo, 'The article text goes he');
  assert.equal(parsed.model, 'claude-opus-5-5');
  assert.deepEqual(parsed.fields, ['keySentences', 'sections']);
  assert.equal(done.usage.output_tokens, 34);
});

test('a plan at its limit says so plainly', async () => {
  const replies = await talk({ type: 'run', user: 'x' }, { FAKE_CLAUDE_FAIL: 'limit' });
  assert.equal(replies.at(-1).type, 'error');
  assert.equal(replies.at(-1).code, 'limit');
  assert.match(replies.at(-1).message, /usage limit/);
});

test('a Codex run answers in one piece, without the reader’s Codex settings', async () => {
  const replies = await talk({
    type: 'run',
    engine: 'codex',
    effort: 'low',
    system: 'Be brief.',
    user: 'The article text goes here.',
    schema: { type: 'object', properties: { keySentences: {}, chapters: {} } },
  });
  const done = replies.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(replies.filter(reply => reply.type === 'delta').map(delta => delta.text).join(''), done.text);
  const parsed = JSON.parse(done.text);
  assert.equal(parsed.echo, 'The article text goes he');
  assert.equal(parsed.effort, 'model_reasoning_effort="low"');
  assert.deepEqual(parsed.fields, ['chapters', 'keySentences']);
  assert.equal(parsed.ignoresConfig, true);
  assert.equal(done.usage.output_tokens, 20);
});

test('Codex at its limit says so plainly', async () => {
  const replies = await talk({ type: 'run', engine: 'codex', user: 'x' }, { FAKE_CODEX_FAIL: 'limit' });
  assert.equal(replies.at(-1).code, 'limit');
});

test('no Claude Code at all is a clear error', async () => {
  const replies = await talk({ type: 'run', user: 'x' }, { CLAUDE_BIN: '/nonexistent', PATH: '/usr/bin:/bin', HOME: '/nonexistent' });
  assert.equal(replies.at(-1).code, 'missing');
});
