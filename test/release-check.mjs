// Loads the release zip's contents as an unpacked extension, as a friend
// would, and checks it starts cleanly and its settings page works.
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
// The welcome page opens on install.
const welcome = context.pages().find(page => page.url().includes(`${id}/options.html`));
const errors = [];
const page = welcome ?? (await context.newPage());
page.on('pageerror', error => errors.push(error.message));
if (!welcome) await page.goto(`chrome-extension://${id}/options.html`);
await page.waitForTimeout(800);
const state = await page.evaluate(() => ({
  title: document.title,
  models: document.querySelectorAll('.model').length,
  consent: document.getElementById('consent')?.checked,
  privacy: document.querySelector('a[href*="privacy"]')?.href,
}));
const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
console.log(JSON.stringify({ id, welcomeOpened: Boolean(welcome), ...state, version: manifest.version, hasKey: 'key' in manifest, hosts: manifest.host_permissions, errors }, null, 1));
await context.close();
