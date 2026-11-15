// The connector, driven the way the browser drives it, against fake `claude`
// and `codex`, so nothing is sent anywhere. The replies go through the same
// code the extension uses to make sense of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PING, claudeReading, codexReading, describe, runRequest } from '../src/local.js';

const HOST = resolve('native/spine-host.sh');
const FAKE = resolve('test/fixtures/fake-claude');
const FAKE_CODEX = resolve('test/fixtures/fake-codex');
const HOME = mkdtempSync(join(tmpdir(), 'spine-home-'));
// Only the fakes: nothing else on this computer is found.
const ENV = { HOME, PATH: '/usr/bin:/bin', SPINE_SEARCH: '', CLAUDE_BIN: FAKE, CODEX_BIN: FAKE_CODEX };

// Sends one framed message and collects every framed reply until the
// connector exits. The browser keeps the pipe open while it listens; closing
// it is how Spine says goodbye.
// closeWhen closes the pipe when a reply matches, as Spine does once a
// reading is done.
function talk(message, env = {}, { closeAfter = null, closeWhen = null } = {}) {
  return new Promise((done, fail) => {
    const started = Date.now();
    const child = spawn('/bin/bash', [HOST], { env: { ...ENV, ...env } });
    const replies = [];
    let buffer = Buffer.alloc(0);
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        const reply = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
        replies.push(reply);
        buffer = buffer.subarray(4 + length);
        if (closeWhen?.(reply)) child.stdin.end();
      }
    });
    child.on('error', fail);
    child.on('exit', () => done(Object.assign(replies, { took: Date.now() - started, leftover: buffer.length })));
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
    if (closeAfter !== null) setTimeout(() => child.stdin.end(), closeAfter);
  });
}

// A reading as the extension sees it: what the connector printed, made sense of.
async function read(request, env, reading) {
  const replies = await talk(runRequest(request), env);
  const out = replies.flatMap(reading());
  return { replies, out, deltas: out.filter(m => m.type === 'delta'), end: out.at(-1) };
}
const claude = request => ({ engine: 'claude-code', model: 'claude-opus-5-5', system: 'Be brief.', schema: { type: 'object', properties: { keySentences: {}, sections: {} } }, ...request });

test('a ping finds Claude Code and Codex, their versions and sign-ins', async () => {
  const replies = await talk(PING);
  assert.equal(replies.length, 1);
  const found = describe(replies[0]);
  assert.equal(found.outdated, false);
  assert.deepEqual(found.claude, { path: FAKE, version: 'Claude Code 9.9.9', signedIn: true, plan: 'Claude Max' });
  assert.deepEqual(found.codex, { path: FAKE_CODEX, version: 'Codex 9.9.9', signedIn: true, plan: 'ChatGPT' });
});

test('a ping says which tool is signed out, or missing', async () => {
  const out = describe((await talk(PING, { FAKE_CLAUDE_LOGGED_OUT: '1', FAKE_CODEX_LOGGED_OUT: '1' }))[0]);
  assert.equal(out.claude.signedIn, false);
  assert.equal(out.codex.signedIn, false);
  const missing = describe((await talk(PING, { CODEX_BIN: '/nonexistent' }))[0]);
  assert.equal(missing.codex, null);
  assert.equal(missing.claude.signedIn, true);
});

test('a ping finds the tools in the usual places when the installer named none', async () => {
  const found = describe((await talk(PING, { CLAUDE_BIN: '', CODEX_BIN: '', SPINE_SEARCH: resolve('test/fixtures/bin') }))[0]);
  assert.equal(found.claude.path, resolve('test/fixtures/bin/claude'));
  assert.equal(found.codex, null);
});

test('a Claude Code reading streams the notes and ends with all of them', async () => {
  const article = 'The article text goes here, sentence by sentence. Ça marche, 日本語 too.\n'.repeat(4000);
  const { replies, deltas, end } = await read(claude({ user: article }), {}, claudeReading);
  assert.equal(replies.leftover, 0);
  assert.ok(deltas.length > 3, 'it should stream');
  assert.equal(end.type, 'done');
  const notes = JSON.parse(end.text);
  assert.deepEqual(JSON.parse(deltas.map(d => d.text).join('')), notes);
  assert.equal(notes.echo, article.slice(0, 24));
  assert.equal(notes.size, Buffer.byteLength(article), 'every byte of the article arrives');
  assert.equal(notes.system, 'Be brief.');
  assert.equal(notes.model, 'claude-opus-5-5');
  assert.equal(notes.tools, '', 'Claude Code runs with no tools');
  assert.equal(notes.cwd, 'work', 'and in Spine’s own quiet folder');
  assert.deepEqual(notes.fields, ['keySentences', 'sections']);
  assert.equal(end.usage.output_tokens, 34);
});

test('a second try at the answer starts the stream over', async () => {
  const { out, end } = await read(claude({ user: 'x' }), { FAKE_CLAUDE_RETRY: '1' }, claudeReading);
  assert.ok(out.some(m => m.type === 'restart'));
  assert.doesNotThrow(() => JSON.parse(end.text));
});

test('a reading is done at Claude Code’s result, even if it lingers, and Spine leaving stops it', async () => {
  const pidfile = join(HOME, 'linger.pid');
  const replies = await talk(runRequest(claude({ user: 'x' })), { FAKE_CLAUDE_LINGER: '1', FAKE_PIDFILE: pidfile }, { closeWhen: reply => reply.type === 'result' });
  const out = replies.flatMap(claudeReading());
  assert.equal(out.at(-1).type, 'done');
  assert.ok(replies.took < 6000, `the connector took ${replies.took} ms`);
  assert.throws(() => process.kill(Number(readFileSync(pidfile, 'utf8')), 0), 'the lingering Claude Code should be gone');
});

test('a warning from Claude Code doesn’t hide its sign-in', async () => {
  const found = describe((await talk(PING, { FAKE_CLAUDE_WARN: '1' }))[0]);
  assert.equal(found.claude.signedIn, true);
  assert.equal(found.claude.plan, 'Claude Max');
});

test('a plan at its limit says so plainly', async () => {
  const { end } = await read(claude({ user: 'x' }), { FAKE_CLAUDE_FAIL: 'limit' }, claudeReading);
  assert.deepEqual([end.type, end.code], ['error', 'limit']);
  assert.match(end.message, /usage limit/);
});

test('a crash passes on what Claude Code said', async () => {
  const { end } = await read(claude({ user: 'x' }), { FAKE_CLAUDE_FAIL: 'crash' }, claudeReading);
  assert.deepEqual([end.type, end.code], ['error', 'local']);
  assert.match(end.message, /something broke inside Claude Code/);
});

test('a tool that isn’t installed says so', async () => {
  const { end } = await read(claude({ user: 'x' }), { CLAUDE_BIN: '/nonexistent' }, claudeReading);
  assert.deepEqual([end.type, end.code], ['error', 'local-setup']);
  assert.match(end.message, /Claude Code isn’t installed/);
});

test('a Codex reading answers once, in a read-only sandbox, ignoring the reader’s Codex settings', async () => {
  const request = { engine: 'codex', effort: 'low', system: 'Spine’s instructions', user: 'The article text goes here.', schema: { type: 'object', properties: { groupings: {} } } };
  const { deltas, end } = await read(request, {}, codexReading);
  assert.equal(deltas.length, 1);
  assert.equal(end.type, 'done');
  const answer = JSON.parse(end.text);
  assert.equal(answer.echo, 'The article text goes he');
  assert.equal(answer.lead, 'Spine’s instructions'.slice(0, 20));
  assert.equal(answer.effort, 'model_reasoning_effort="low"');
  assert.deepEqual(answer.fields, ['groupings']);
  assert.equal(answer.ignoresConfig, true);
  assert.equal(answer.sandbox, 'read-only');
  assert.equal(answer.noShell, true, 'Codex runs without its shell, so an article can’t make it read files');
  assert.equal(end.usage.output_tokens, 20);
});

test('a Codex retry it recovers from doesn’t spoil the answer', async () => {
  const { end } = await read({ engine: 'codex', user: 'x', schema: { type: 'object', properties: {} } }, { FAKE_CODEX_RECONNECT: '1' }, codexReading);
  assert.equal(end.type, 'done');
});

test('Codex at its limit says so plainly', async () => {
  const { end } = await read({ engine: 'codex', user: 'x' }, { FAKE_CODEX_FAIL: 'limit' }, codexReading);
  assert.deepEqual([end.type, end.code], ['error', 'limit']);
});

test('when Spine goes away, the connector stops Claude Code at once', async () => {
  const pidfile = join(HOME, 'slow.pid');
  const replies = await talk(runRequest(claude({ user: 'x' })), { FAKE_CLAUDE_SLOW: '1', FAKE_PIDFILE: pidfile }, { closeAfter: 1500 });
  assert.ok(replies.took < 6000, `the connector took ${replies.took} ms to stop`);
  const pid = Number(readFileSync(pidfile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), 'the fake Claude Code should be gone');
});

test('it leaves nothing behind in its folder', async () => {
  await talk(runRequest(claude({ user: 'x' })));
  await talk(PING);
  assert.ok(existsSync(resolve('native/work')));
  assert.deepEqual(readdirSync(resolve('native/work')).filter(name => name.startsWith('run.')), []);
});

test('an older Spine is told to update, and odd requests are refused', async () => {
  // Spine 1.2 hears a pong it understands, so it tries a reading...
  const [pong] = await talk({ type: 'ping' });
  assert.deepEqual([pong.type, pong.claude.signedIn], ['pong', true]);
  // ...and the reading says Spine needs updating.
  const [old] = await talk({ type: 'run', engine: 'claude', user: 'x' });
  assert.deepEqual([old.type, old.code], ['error', 'update']);
  const [unknown] = await talk('hello');
  assert.equal(unknown.type, 'refused');
  const [engine] = await talk(runRequest({ engine: 'claude-code', user: 'x' }).replace(/^run\.[^.]+/, 'run.' + Buffer.from('rm').toString('base64url')));
  assert.match(engine.message, /Unknown engine/);
  const [model] = await talk(runRequest({ engine: 'claude-code', model: 'opus; rm -rf ~', user: 'x' }));
  assert.match(model.message, /Unknown model/);
});
