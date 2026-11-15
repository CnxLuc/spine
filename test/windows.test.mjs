// Spine's Windows connector, built with Windows' own C# compiler and driven
// the way the browser drives it, against a fake claude.exe and codex.exe. The
// replies go through the same code the extension uses. Then the connect
// command, as a reader would run it. Only on Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PING, claudeReading, codexReading, describe, runRequest } from '../src/local.js';

const windows = process.platform === 'win32';
const csc = windows
  ? [`${process.env.WINDIR}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`, `${process.env.WINDIR}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`].find(path => existsSync(path))
  : null;
const place = mkdtempSync(join(tmpdir(), 'spine-windows-'));
const HOST = join(place, 'host', 'spine-host.exe');
const BIN = join(place, 'bin');
const FAKE = join(BIN, 'claude.exe');
const FAKE_CODEX = join(BIN, 'codex.exe');
if (windows) {
  mkdirSync(join(place, 'host'), { recursive: true });
  mkdirSync(BIN, { recursive: true });
  execFileSync(csc, ['/nologo', '/optimize+', '/target:exe', `/out:${HOST}`, resolve('native/SpineHost.cs')]);
  execFileSync(csc, ['/nologo', '/target:exe', `/out:${FAKE}`, resolve('test/fixtures/FakeClaude.cs')]);
  copyFileSync(FAKE, FAKE_CODEX);
}
// Only the fakes: nothing else on this computer is found.
const ENV = { ...process.env, PATH: `${process.env.WINDIR}\\System32`, SPINE_SEARCH: '', CLAUDE_BIN: FAKE, CODEX_BIN: FAKE_CODEX, USERPROFILE: place };

function talk(message, env = {}, { closeAfter = null, program = HOST } = {}) {
  return new Promise((done, fail) => {
    const started = Date.now();
    const child = spawn(program, ['chrome-extension://hbaekihlobpbmhciebgibgeljinadcib/'], { env: { ...ENV, ...env } });
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
    child.on('exit', () => done(Object.assign(replies, { took: Date.now() - started, leftover: buffer.length })));
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
    if (closeAfter !== null) setTimeout(() => child.stdin.end(), closeAfter);
  });
}
async function read(request, env, reading) {
  const replies = await talk(runRequest(request), env);
  const out = replies.flatMap(reading());
  return { replies, out, deltas: out.filter(m => m.type === 'delta'), end: out.at(-1) };
}

test('on Windows, a ping finds Claude Code and Codex, their versions and sign-ins', { skip: !windows }, async () => {
  const found = describe((await talk(PING))[0]);
  assert.deepEqual(found.claude, { path: FAKE, version: 'Claude Code 9.9.9', signedIn: true, plan: 'Claude Max' });
  assert.equal(found.codex.signedIn, true);
  const missing = describe((await talk(PING, { CODEX_BIN: 'C:\\nowhere\\codex.exe' }))[0]);
  assert.equal(missing.codex, null);
});

test('on Windows, a Claude Code reading streams and every argument arrives intact', { skip: !windows }, async () => {
  const article = 'The article text goes here. Ça marche, 日本語 too, with "quotes" and C:\\back\\slashes\\.\n'.repeat(3000);
  const system = 'Line one says "hello".\nLine two ends with a backslash \\';
  const schema = { type: 'object', properties: { keySentences: { type: 'array', items: { type: 'string', description: 'an id like "s12"' } } } };
  const { replies, deltas, end } = await read({ engine: 'claude-code', model: 'claude-opus-5-5', system, schema, user: article }, {}, claudeReading);
  assert.equal(replies.leftover, 0);
  assert.ok(deltas.length > 3, 'it should stream');
  assert.equal(end.type, 'done');
  const notes = JSON.parse(end.text);
  assert.equal(notes.size, Buffer.byteLength(article), 'every byte of the article arrives');
  assert.equal(notes.system, system);
  assert.deepEqual(JSON.parse(notes.schema), schema);
  assert.equal(notes.model, 'claude-opus-5-5');
  assert.equal(notes.tools, '');
  assert.equal(notes.cwd, 'work');
});

test('on Windows, a Codex reading answers once, in a read-only sandbox', { skip: !windows }, async () => {
  const { end } = await read({ engine: 'codex', effort: 'low', system: 'Spine’s instructions', user: 'The article text goes here.', schema: { type: 'object' } }, {}, codexReading);
  assert.equal(end.type, 'done');
  const answer = JSON.parse(end.text);
  assert.equal(answer.effort, 'model_reasoning_effort="low"');
  assert.equal(answer.sandbox, 'read-only');
  assert.equal(answer.schema, true);
});

test('on Windows, a plan at its limit says so, and a missing tool says so', { skip: !windows }, async () => {
  const limit = await read({ engine: 'claude-code', user: 'x' }, { FAKE_CLAUDE_FAIL: 'limit' }, claudeReading);
  assert.deepEqual([limit.end.type, limit.end.code], ['error', 'limit']);
  const missing = await read({ engine: 'claude-code', user: 'x' }, { CLAUDE_BIN: 'C:\\nowhere\\claude.exe' }, claudeReading);
  assert.equal(missing.end.code, 'local-setup');
});

test('on Windows, when Spine goes away, the connector stops Claude Code at once', { skip: !windows }, async () => {
  const pidfile = join(place, 'slow.pid');
  const replies = await talk(runRequest({ engine: 'claude-code', user: 'x' }), { FAKE_CLAUDE_SLOW: '1', FAKE_PIDFILE: pidfile }, { closeAfter: 2500 });
  assert.ok(replies.took < 10000, `the connector took ${replies.took} ms to stop`);
  const pid = Number(readFileSync(pidfile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), 'the fake Claude Code should be gone');
});

test('on Windows, an older Spine is told to update, and odd requests are refused', { skip: !windows }, async () => {
  const [old] = await talk({ type: 'ping' });
  assert.deepEqual([old.type, old.code], ['error', 'update']);
  const [model] = await talk(runRequest({ engine: 'claude-code', model: 'opus & calc', user: 'x' }));
  assert.equal(model.type, 'refused');
});

test('on Windows, the connect command installs Claude Code, signs in and registers the connector', { skip: !windows }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spine-home-'));
  const local = join(home, 'AppData', 'Local');
  mkdirSync(join(local, 'Google', 'Chrome'), { recursive: true });
  const installer = join(home, 'fake-install.ps1');
  writeFileSync(installer, `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.local\\bin" | Out-Null\nCopy-Item -LiteralPath '${FAKE}' -Destination "$env:USERPROFILE\\.local\\bin\\claude.exe"\nWrite-Host 'Installation complete'\n`);
  const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('docs/connect.ps1')], {
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: home, LOCALAPPDATA: local, PATH: `${process.env.WINDIR}\\System32;${process.env.WINDIR}\\System32\\WindowsPowerShell\\v1.0`, SPINE_YES: '1', SPINE_CLAUDE_INSTALLER: installer, FAKE_CLAUDE_LOGGED_OUT: '1' },
  });
  const said = run.stdout + run.stderr;
  assert.equal(run.status, 0, said);
  assert.match(said, /Installing Claude Code, with Anthropic's installer/);
  assert.match(said, /Spine is connected to Claude Code 9\.9\.9 in Chrome\./, said);
  const key = spawnSync('reg', ['query', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.spine.local', '/ve'], { encoding: 'utf8' }).stdout;
  const manifestPath = join(local, 'Spine', 'com.spine.local.json');
  assert.ok(key.includes(manifestPath), key);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.path, join(local, 'Spine', 'spine-host.exe'));
  assert.ok(manifest.allowed_origins.includes('chrome-extension://hbaekihlobpbmhciebgibgeljinadcib/'));
  // The installed connector remembers where Claude Code is, with a browser's PATH.
  const found = describe((await talk(PING, { CLAUDE_BIN: '', CODEX_BIN: '', USERPROFILE: home, FAKE_CLAUDE_LOGGED_OUT: '1' }, { program: manifest.path }))[0]);
  assert.equal(found.claude.path, join(home, '.local', 'bin', 'claude.exe'));
  assert.equal(found.claude.signedIn, true);
});
