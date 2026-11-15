// The command that connects Spine to Claude Code, run against a stand-in home
// folder, with fake Claude Code and Codex and a fake Anthropic installer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PING, describe } from '../src/local.js';
import { installer } from '../tools/installer.mjs';

const ID = 'hbaekihlobpbmhciebgibgeljinadcib';
const STORE = 'abcdefghijklmnopabcdefghijklmnop';
const script = join(mkdtempSync(join(tmpdir(), 'spine-connect-')), 'connect.sh');
writeFileSync(script, await installer([ID, STORE]), { mode: 0o755 });

const mac = process.platform === 'darwin';
// A home folder with Chrome and Arc in it, and the tools in their own folder.
function home({ claude = true, codex = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'spine-home-'));
  const data = mac ? join(root, 'Library/Application Support') : join(root, '.config');
  for (const browser of mac ? ['Google/Chrome', 'Arc/User Data'] : ['google-chrome', 'chromium']) mkdirSync(join(data, browser), { recursive: true });
  const bin = join(root, 'tools');
  mkdirSync(bin);
  if (claude) execFileSync('cp', [resolve('test/fixtures/fake-claude'), join(bin, 'claude')]);
  if (codex) execFileSync('cp', [resolve('test/fixtures/fake-codex'), join(bin, 'codex')]);
  const folder = mac ? join(data, 'Spine') : join(root, '.local/share/spine');
  return { root, data, bin, folder, manifest: browser => join(data, browser, 'NativeMessagingHosts/com.spine.local.json') };
}
function connect(place, args = [], env = {}) {
  const run = spawnSync('/bin/bash', [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      HOME: place.root,
      PATH: `${place.bin}:/usr/bin:/bin`,
      SPINE_CLAUDE_INSTALLER: `file://${resolve('test/fixtures/fake-claude-installer.sh')}`,
      FAKE_CLAUDE_SOURCE: resolve('test/fixtures/fake-claude'),
      // No terminal to ask questions in, wherever the tests run.
      SPINE_TTY: '0',
      ...env,
    },
  });
  return { ...run, said: run.stdout + run.stderr };
}
// Asks the installed connector what it finds, the way the browser does.
function ping(place, env = {}) {
  const manifest = JSON.parse(readFileSync(place.manifest(mac ? 'Google/Chrome' : 'google-chrome'), 'utf8'));
  return new Promise(done => {
    const child = spawn(manifest.path, [`chrome-extension://${ID}/`], { env: { HOME: place.root, PATH: '/usr/bin:/bin', SPINE_SEARCH: '', ...env } });
    let buffer = Buffer.alloc(0);
    child.stdout.on('data', chunk => (buffer = Buffer.concat([buffer, chunk])));
    child.on('exit', () => done(describe(JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32LE(0))))));
    const body = Buffer.from(JSON.stringify(PING));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.end(Buffer.concat([header, body]));
  });
}

test('with Claude Code signed in, it connects every browser, for both copies of Spine', async () => {
  const place = home({ claude: true, codex: true });
  const run = connect(place);
  assert.equal(run.status, 0, run.said);
  assert.match(run.said, /Spine is connected to Claude Code 9\.9\.9 and Codex 9\.9\.9 in (Chrome and Arc|Chrome and Chromium)\./);
  assert.match(run.said, /Go back to Spine: it starts reading by itself/);
  for (const browser of mac ? ['Google/Chrome', 'Arc/User Data'] : ['google-chrome', 'chromium']) {
    const manifest = JSON.parse(readFileSync(place.manifest(browser), 'utf8'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${ID}/`, `chrome-extension://${STORE}/`]);
    assert.equal(manifest.path, join(place.folder, 'spine-host'));
  }
  // The browser's short PATH finds nothing, but the connector remembers where the tools are.
  const found = await ping(place);
  assert.equal(found.claude.path, join(place.bin, 'claude'));
  assert.equal(found.claude.signedIn, true);
  assert.equal(found.codex.signedIn, true);
});

test('without Claude Code, it installs it with Anthropic’s installer and signs in', async () => {
  const place = home({ claude: false });
  const run = connect(place, ['--yes'], { FAKE_CLAUDE_LOGGED_OUT: '1' });
  assert.equal(run.status, 0, run.said);
  assert.match(run.said, /Installing Claude Code, with Anthropic's installer/);
  assert.match(run.said, /Signing in to Claude/);
  assert.match(run.said, /Spine is connected to Claude Code 9\.9\.9/);
  assert.ok(existsSync(join(place.root, '.local/bin/claude')));
  assert.ok(existsSync(join(place.root, '.fake-claude-signed-in')), 'it ran claude auth login');
  const found = await ping(place, { FAKE_CLAUDE_LOGGED_OUT: '1' });
  assert.equal(found.claude.path, join(place.root, '.local/bin/claude'));
  assert.equal(found.claude.signedIn, true);
});

test('with no one to ask, it installs nothing but the connector, and says what’s missing', async () => {
  const place = home({ claude: false });
  const run = connect(place);
  assert.equal(run.status, 0, run.said);
  assert.match(run.said, /To install it, run: curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);
  assert.match(run.said, /connector is installed in Chrome and (Arc|Chromium), but Claude Code isn't ready yet/);
  assert.ok(!existsSync(join(place.root, '.local/bin/claude')));
  assert.equal((await ping(place)).claude, null);
});

test('it replaces the Python connector from Spine 1.2, and uninstalls cleanly', async () => {
  const place = home();
  mkdirSync(place.folder, { recursive: true });
  writeFileSync(join(place.folder, 'spine_host.py'), '# old');
  assert.equal(connect(place).status, 0);
  assert.ok(!existsSync(join(place.folder, 'spine_host.py')));
  assert.ok(existsSync(join(place.folder, 'spine-host.sh')));
  const gone = connect(place, ['--uninstall']);
  assert.match(gone.said, /Removed Spine's connection/);
  assert.ok(!existsSync(place.folder));
  assert.ok(!existsSync(place.manifest(mac ? 'Google/Chrome' : 'google-chrome')));
});

test('with no browser it knows, it says so', () => {
  const place = home();
  execFileSync('rm', ['-rf', place.data]);
  mkdirSync(place.data, { recursive: true });
  const run = connect(place);
  assert.notEqual(run.status, 0);
  assert.match(run.said, /no supported browser found/);
});
