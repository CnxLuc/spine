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
const look = async (options, { name, engine } = {}) => {
  const { context, id } = await launch(options);
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
  assert.match(state.claude, /Connected: 9\.9\.9 \(Claude Code\), signed in to your Claude plan/);
  assert.match(state.codex, /Connected: codex-cli 9\.9\.9, signed in to your ChatGPT plan/);
  assert.equal(state.setup, false);
  assert.deepEqual([state.engine, state.settings.engine, state.settings.billing, state.settings.ready], ['claude-code', 'claude-code', 'plan', true]);
});

await check('with only Codex, Spine uses Codex, on the ChatGPT plan', async () => {
  const state = await look({ codex: FAKE_CODEX }, { name: 'options-codex' });
  assert.match(state.claude, /Claude Code isn’t installed/);
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
  assert.match(state.claude, /not signed in\. Run claude/);
  assert.match(state.codex, /not signed in\. Run codex/);
  assert.equal(state.settings.engine, 'api');
});

await check('with no connector, Spine shows the one command to run', async () => {
  const state = await look({}, { name: 'options-not-connected' });
  assert.equal(state.claude, 'Not connected yet.');
  assert.equal(state.setup, true);
  assert.equal(state.engine, 'api');
});

console.log(results.join('\n'));
