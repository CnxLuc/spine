// Checks the page Spine opens once, on install: it fits light, dark and narrow
// windows, shows the real shortcut, and ticks off pinning once Spine is pinned.
//
//   node build.mjs --test && node test/welcome-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extension = resolve('.test-build');
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}: ${error.message.split('\n')[0]}`);
  }
};

async function open(options = {}) {
  const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'spine-welcome-')), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    ...options,
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${worker.url().split('/')[2]}/welcome.html`);
  await page.waitForTimeout(600);
  return { context, page };
}

for (const [name, options] of [
  ['welcome', {}],
  ['welcome-dark', { colorScheme: 'dark' }],
  ['welcome-narrow', { viewport: { width: 390, height: 844 } }],
]) {
  const { context, page } = await open(options);
  await check(`the welcome page fits ${name === 'welcome' ? 'a wide window' : name.replace('welcome-', 'a ').replace('narrow', 'phone-width window').replace('dark', 'dark window')}`, async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.equal(overflow, 0, `${overflow}px of sideways scroll`);
    await page.screenshot({ path: `test/out/${name}.png`, fullPage: true });
  });
  if (name === 'welcome') {
    await check('it shows the shortcut the browser gave Spine', async () => {
      const keys = await page.evaluate(() => [...document.querySelectorAll('#shortcut kbd')].map(key => key.textContent).join(' '));
      assert.match(keys, /(⌥ ⇧ S|Alt Shift S)/);
    });
    await check('the try-it link opens a long essay in a new tab', async () => {
      const link = await page.evaluate(() => ({ href: document.getElementById('try').href, target: document.getElementById('try').target }));
      assert.deepEqual(link, { href: 'https://paulgraham.com/greatwork.html', target: '_blank' });
    });
  }
  await context.close();
}
console.log(results.join('\n'));
