// Spine's Windows connector, built with Windows' own C# compiler and driven
// the way the browser drives it, against a fake claude.exe and codex.exe. The
// replies go through the same code the extension uses. Then the connect
// command, as a reader would run it. Only on Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
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

function talk(message, env = {}, { closeAfter = null, closeWhen = null, program = HOST } = {}) {
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
  assert.equal(notes.mark, false, 'and nothing before it');
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
  assert.equal(answer.noShell, true, 'Codex runs without its shell');
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

test('on Windows, a reading is done at the result, even if Claude Code lingers', { skip: !windows }, async () => {
  const pidfile = join(place, 'linger.pid');
  const replies = await talk(runRequest({ engine: 'claude-code', user: 'x' }), { FAKE_CLAUDE_LINGER: '1', FAKE_PIDFILE: pidfile }, { closeWhen: reply => reply.type === 'result' });
  assert.equal(replies.flatMap(claudeReading()).at(-1).type, 'done');
  assert.ok(replies.took < 10000, `the connector took ${replies.took} ms`);
  assert.throws(() => process.kill(Number(readFileSync(pidfile, 'utf8')), 0), 'the lingering Claude Code should be gone');
});

test('on Windows, an older Spine is told to update, and odd requests are refused', { skip: !windows }, async () => {
  const [pong] = await talk({ type: 'ping' });
  assert.deepEqual([pong.type, pong.claude.signedIn], ['pong', true]);
  const [old] = await talk({ type: 'run', engine: 'claude', user: 'x' });
  assert.deepEqual([old.type, old.code], ['error', 'update']);
  const [model] = await talk(runRequest({ engine: 'claude-code', model: 'opus & calc', user: 'x' }));
  assert.equal(model.type, 'refused');
});

// The registry keys the command writes, put back as they were afterwards, so
// running the tests on a real PC doesn't point its browsers at a temp folder.
const KEYS = ['Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser', 'Vivaldi', 'Chromium'].map(
  browser => `HKCU\\Software\\${browser}\\NativeMessagingHosts\\com.spine.local`,
);
function saveKeys() {
  return KEYS.map(key => {
    const found = spawnSync('reg', ['query', key, '/ve'], { encoding: 'utf8' });
    const value = found.status === 0 ? found.stdout.match(/REG_SZ\s+(.*)/)?.[1]?.trim() : null;
    return { key, value };
  });
}
function restoreKeys(saved) {
  for (const { key, value } of saved) {
    if (value) spawnSync('reg', ['add', key, '/ve', '/d', value, '/f']);
    else spawnSync('reg', ['delete', key, '/f']);
  }
}
// A home folder with a space and an accent in its name, as many have.
function home() {
  const root = mkdtempSync(join(tmpdir(), 'spine home é-'));
  const local = join(root, 'AppData', 'Local');
  mkdirSync(join(local, 'Google', 'Chrome'), { recursive: true });
  const installer = join(root, 'fake-install.ps1');
  writeFileSync(installer, `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.local\\bin" | Out-Null\nCopy-Item -LiteralPath '${FAKE}' -Destination "$env:USERPROFILE\\.local\\bin\\claude.exe"\nWrite-Host 'Installation complete'\n`);
  const env = {
    ...process.env,
    USERPROFILE: root,
    LOCALAPPDATA: local,
    APPDATA: join(root, 'AppData', 'Roaming'),
    SPINE_YES: '1',
    SPINE_CLAUDE_INSTALLER: installer,
    FAKE_CLAUDE_LOGGED_OUT: '1',
  };
  return { root, local, env, folder: join(local, 'com.spine.local') };
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

// The script exactly as a reader runs it: fetched with irm and run with iex,
// served as text the way raw.githubusercontent.com serves it.
async function serve() {
  const script = readFileSync(resolve('docs/connect.ps1'));
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(script);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { server, url: `http://127.0.0.1:${server.address().port}/connect.ps1` };
}
function run(shell, url, env) {
  const result = spawnSync(shell, ['-NoProfile', '-Command', `irm '${url}' | iex`], { encoding: 'utf8', env, timeout: 180000 });
  return { ...result, said: `${result.stdout}${result.stderr}` };
}
const pwsh = windows && spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;

for (const shell of ['powershell.exe', 'pwsh']) {
  test(`on Windows, irm | iex in ${shell} installs Claude Code, signs in and registers the connector`, { skip: !windows || (shell === 'pwsh' && !pwsh) }, async () => {
    const saved = saveKeys();
    const { server, url } = await serve();
    try {
      const place = home();
      const result = run(shell, url, place.env);
      assert.match(result.said, /Installing Claude Code, with Anthropic's installer/, result.said);
      assert.match(result.said, /Spine is connected to Claude Code 9\.9\.9 in Chrome( and Edge)?\./, result.said);
      const key = spawnSync('reg', ['query', KEYS[0], '/ve'], { encoding: 'utf8' }).stdout;
      const manifestPath = join(place.folder, 'com.spine.local.json');
      assert.ok(key.includes(manifestPath), key);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.path, join(place.folder, 'spine-host.exe'));
      assert.ok(manifest.allowed_origins.includes('chrome-extension://hbaekihlobpbmhciebgibgeljinadcib/'));
      // The installed connector remembers where Claude Code is, with a browser's PATH.
      const found = describe((await talk(PING, { CLAUDE_BIN: '', CODEX_BIN: '', USERPROFILE: place.root, FAKE_CLAUDE_LOGGED_OUT: '1' }, { program: manifest.path }))[0]);
      assert.equal(found.claude.path, join(place.root, '.local', 'bin', 'claude.exe'));
      assert.equal(found.claude.signedIn, true);
    } finally {
      server.close();
      restoreKeys(saved);
    }
  });
}

test('on Windows, running the command again while the connector is reading puts the new one in place', { skip: !windows }, async () => {
  const saved = saveKeys();
  const { server, url } = await serve();
  try {
    const place = home();
    assert.equal(run('powershell.exe', url, place.env).status, 0);
    const program = join(place.folder, 'spine-host.exe');
    const before = hash(program);
    // A slow reading keeps the connector running while the command runs again.
    const reading = talk(runRequest({ engine: 'claude-code', user: 'x' }), { FAKE_CLAUDE_SLOW: '1', USERPROFILE: place.root }, { program, closeAfter: 20000 });
    await new Promise(done => setTimeout(done, 1500));
    const again = run('powershell.exe', url, place.env);
    assert.match(again.said, /Spine is connected to Claude Code/, again.said);
    assert.notEqual(hash(program), before, 'the new connector is in place');
    await reading;
  } finally {
    server.close();
    restoreKeys(saved);
  }
});

test('on Windows, uninstalling removes the connector and its keys, once', { skip: !windows }, async () => {
  const saved = saveKeys();
  const { server, url } = await serve();
  try {
    const place = home();
    assert.equal(run('powershell.exe', url, place.env).status, 0);
    const gone = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$env:SPINE_UNINSTALL = 1; irm '${url}' | iex; "after: [$env:SPINE_UNINSTALL]"`], { encoding: 'utf8', env: place.env });
    assert.match(gone.stdout, /Removed Spine's connection/);
    assert.match(gone.stdout, /after: \[\]/, 'the uninstall setting doesn’t stay on');
    assert.ok(!existsSync(place.folder));
    assert.notEqual(spawnSync('reg', ['query', KEYS[0], '/ve']).status, 0);
  } finally {
    server.close();
    restoreKeys(saved);
  }
});
