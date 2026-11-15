// Checks Spine finds Claude Code and Codex through the native host, with fake
// tools signed in, signed out, and with no connector at all.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { launch } from './browser.mjs';

const FAKE_CLAUDE = resolve('test/fixtures/fake-claude');
const FAKE_CODEX = resolve('test/fixtures/fake-codex');
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}: ${error.message.split('\n')[0]}`);
  }
};
const look = async (options, { name, engine, before } = {}) => {
  const { context, id, profile } = await launch(options);
  await before?.(profile);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  if (engine) await page.evaluate(engine => chrome.storage.local.set({ engine }), engine);
  if (engine) await page.reload();
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    claude: document.getElementById('claude-status').textContent,
    codex: document.getElementById('codex-status').textContent,
    setup: !document.getElementById('local-setup').hidden,
    engine: document.querySelector('input[name="engine"]:checked')?.value,
    models: !document.getElementById('models-field').hidden,
  }));
  const settings = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'spine:settings' }));
  if (name) await page.screenshot({ path: `test/out/${name}.png`, fullPage: true });
  await context.close();
  return { ...state, settings };
};

await check('with both signed in, Spine prefers Claude Code, on the Claude plan', async () => {
  const state = await look({ claude: FAKE_CLAUDE, codex: FAKE_CODEX }, { name: 'options-both' });
  assert.match(state.claude, /Connected: Claude Code 9\.9\.9, signed in to your Claude Max plan/);
  assert.match(state.codex, /Connected: Codex 9\.9\.9, signed in to your ChatGPT plan/);
  assert.equal(state.setup, false);
  assert.deepEqual([state.engine, state.settings.engine, state.settings.billing, state.settings.ready], ['claude-code', 'claude-code', 'plan', true]);
});

await check('with only Codex, Spine uses Codex, on the ChatGPT plan', async () => {
  const state = await look({ codex: FAKE_CODEX }, { name: 'options-codex' });
  assert.match(state.claude, /Claude Code isn’t on this computer yet\. The command below installs it/);
  assert.equal(state.setup, false, 'Codex is ready and chosen, so no need to nag');
  assert.deepEqual([state.engine, state.settings.engine, state.settings.billing], ['codex', 'codex', 'plan']);
  assert.equal(state.models, false, 'Claude models don’t apply to Codex');
});

await check('choosing Codex when both are here sticks', async () => {
  const state = await look({ claude: FAKE_CLAUDE, codex: FAKE_CODEX }, { engine: 'codex' });
  assert.equal(state.settings.engine, 'codex');
});

await check('signed out tools are named, and Spine falls back to a key', async () => {
  process.env.FAKE_CLAUDE_LOGGED_OUT = '1';
  process.env.FAKE_CODEX_LOGGED_OUT = '1';
  const state = await look({ claude: FAKE_CLAUDE, codex: FAKE_CODEX });
  delete process.env.FAKE_CLAUDE_LOGGED_OUT;
  delete process.env.FAKE_CODEX_LOGGED_OUT;
  assert.match(state.claude, /not signed in\. Run the command below to sign in/);
  assert.match(state.codex, /not signed in\. Run codex login/);
  assert.equal(state.setup, true);
  assert.equal(state.settings.engine, 'api');
});

await check('with no connector, Spine shows the one command to run', async () => {
  const state = await look({}, { name: 'options-not-connected' });
  assert.equal(state.claude, 'Not connected yet.');
  assert.equal(state.setup, true);
  assert.equal(state.engine, undefined, 'nothing chosen yet, so nothing selected');
  assert.equal(state.settings.engine, 'api');
});

// Spine 1.2's connector, written in Python, as people who connected Claude Code
// before 1.3 still have it.
await check('an old Python connector asks for the command again', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = await mkdtemp(join(tmpdir(), 'spine-old-'));
  const old = join(folder, 'spine_host.py');
  await writeFile(old, execFileSync('git', ['show', '2db50f9:native/spine_host.py']));
  const state = await look({}, { name: 'options-old-connector', before: async profile => {
    const { connectLocal } = await import('./browser.mjs');
    await connectLocal(profile, { claude: FAKE_CLAUDE, host: ['/usr/bin/python3', old] });
  } });
  assert.match(state.claude, /Spine’s connection needs updating\. Run the command below/);
  assert.equal(state.setup, true);
});

console.log(results.join('\n'));
