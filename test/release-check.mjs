// Loads the release zip's contents as an unpacked extension, as a friend
// would, and checks it starts cleanly: the welcome page opens by itself, and
// the welcome and settings pages work.
//
//   unzip releases/spine.zip -d /tmp/spine && node test/release-check.mjs /tmp/spine
import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const folder = process.argv[2];
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'spine-release-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${folder}`, `--load-extension=${folder}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 });
const id = worker.url().split('/')[2];
await new Promise(done => setTimeout(done, 1500));
const errors = [];
// The welcome page opens on install.
const welcome = context.pages().find(page => page.url() === `chrome-extension://${id}/welcome.html`);
const page = welcome ?? (await context.newPage());
page.on('pageerror', error => errors.push(error.message));
if (!welcome) await page.goto(`chrome-extension://${id}/welcome.html`);
await page.reload();
await page.waitForTimeout(800);
const greeting = await page.evaluate(() => ({ title: document.title, steps: document.querySelectorAll('.step').length, shortcut: document.getElementById('shortcut').textContent }));
await page.goto(`chrome-extension://${id}/options.html`);
await page.waitForTimeout(1500);
const state = await page.evaluate(() => ({
  title: document.title,
  models: document.querySelectorAll('.model').length,
  consent: document.getElementById('consent')?.checked,
  chosen: document.querySelector('input[name="engine"]:checked')?.value ?? null,
  claude: document.getElementById('claude-status').textContent,
  privacy: document.querySelector('a[href*="privacy"]')?.href,
}));
const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
console.log(JSON.stringify({ id, welcomeOpened: Boolean(welcome), greeting, ...state, version: manifest.version, hasKey: 'key' in manifest, hosts: manifest.host_permissions, errors }, null, 1));
await context.close();
