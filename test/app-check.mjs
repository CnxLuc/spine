// Checks Spine for iPhone end to end, with a stand-in for OpenAI. Spine's
// settings on a computer sign in to ChatGPT for the iPhone and copy the
// sign-in. The app on an iPhone, in Chromium and in WebKit, takes it, adds an
// article by its link and reads it on the phone. Opening it again reads
// nothing, a run-out sign-in renews itself, and the computer's own sign-in is
// never touched.
//
//   node build.mjs --test && node share/build.mjs --test && node test/app-check.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, devices, webkit } from 'playwright';
import { launch, setStorage } from './browser.mjs';
import { startFakeOpenAI } from './fixtures/fake-openai.mjs';
import { startShareServer } from './share-server.mjs';
import { decodeHandoff } from '../src/shared/handoff.js';

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}: ${error.message.split('\n').slice(0, 6).join(' / ')}`);
  }
};
const until = async (fn, { timeout = 15000, every = 150 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await fn().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`waited ${timeout} ms for ${fn}`);
    await new Promise(done => setTimeout(done, every));
  }
};
await mkdir('test/out', { recursive: true });
const picture = (page, name) => page.screenshot({ path: `test/out/${name}.png` });

const fake = await startFakeOpenAI();
const server = await startShareServer();
const stand = { issuer: fake.url, api: `${fake.url}/v1` };

/* The computer: Spine's settings sign in for the iPhone */

let handoff = '';
const mac = await launch();
await setStorage(mac.worker, 'local', { chatgptTest: stand, shareKey: server.key, shareServer: server.origin });
const options = await mac.context.newPage();
await options.goto(`chrome-extension://${mac.id}/options.html`);

await check('Spine’s settings sign in to ChatGPT for the iPhone and copy the sign-in', async () => {
  // What Copy puts on the clipboard, kept where the test can read it.
  await options.evaluate(() => {
    navigator.clipboard.writeText = async text => {
      window.copied = text;
    };
  });
  const opened = mac.context.waitForEvent('page');
  await options.click('#phone-sign-in');
  const window = await opened;
  await window.waitForLoadState();
  await window.click('#allow');
  await until(() => options.locator('#phone-copy').isVisible());
  assert.match(await options.textContent('#phone-status'), /Signed in for your iPhone/);
  await options.click('#phone-copy');
  handoff = await options.evaluate(() => window.copied);
  assert.match(await options.textContent('#phone-status'), /Copied/);
  await options.locator('#iphone').screenshot({ path: 'test/out/app-settings-iphone.png' });
});

await check('the iPhone gets a sign-in of its own, and the computer keeps none of its tokens', async () => {
  const { server: where, key, chatgpt } = decodeHandoff(handoff);
  assert.equal(where, server.origin);
  assert.equal(key, server.key);
  assert.match(chatgpt.accessToken, /^at-\d+$/);
  assert.match(chatgpt.refreshToken, /^rt-\d+$/);
  const asked = fake.seen.authorize.at(-1);
  assert.equal(asked.agent_name_hint, 'Spine for iPhone');
  assert.equal(asked.ext_agent_host_id, chatgpt.hostId);
  assert.match(asked.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  const engine = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'spine:engine' }));
  assert.equal(engine.chatgpt.signedIn, false, 'the computer signed itself in');
  const { engine: chosen } = await options.evaluate(() => chrome.storage.local.get('engine'));
  assert.notEqual(chosen, 'chatgpt', 'signing in for the phone chose ChatGPT on the computer');
});

await check('signing in for the iPhone again keeps its registration', async () => {
  const before = decodeHandoff(handoff).chatgpt;
  const opened = mac.context.waitForEvent('page');
  await options.click('#phone-sign-in');
  const window = await opened;
  await window.waitForLoadState();
  const asked = fake.seen.authorize.at(-1);
  assert.equal(asked.client_id, before.clientId);
  assert.equal(asked.ext_agent_host_id, before.hostId);
  await window.click('#allow');
  await until(() => options.locator('#phone-copy').isVisible());
});
await mac.context.close();

/* The phone */

const browsers = { chromium: await chromium.launch(), webkit: await webkit.launch() };
for (const [engine, browser] of Object.entries(browsers)) {
  const phone = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await phone.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  const reader = fn => page.evaluate(source => new Function('reader', `return (${source})(reader)`)(globalThis.__spineTest), fn.toString());
  const state = () => reader(r => r?.root.dataset.ai ?? null);

  await check(`on an iPhone (${engine}), the app asks to be connected, and takes the sign-in`, async () => {
    await page.goto(`${server.origin}/app/`);
    await page.waitForSelector('.connect');
    assert.match(await page.textContent('.connect'), /Sign in for your iPhone/);
    await picture(page, `app-${engine}-connect`);
    await page.evaluate(stand => chrome.storage.local.set({ chatgptTest: stand }), stand);
    await page.fill('.paste-box', `Here: ${handoff}`);
    await page.waitForSelector('.library', { timeout: 10000 });
    assert.match(await page.textContent('.library'), /Nothing to read yet/);
  });

  await check(`on an iPhone (${engine}), an article added by its link is read on the phone`, async () => {
    const asked = fake.seen.responses.length;
    await page.locator('.add').tap();
    await page.fill('.link', `${fake.url}/article`);
    await page.locator('.add-form .primary').tap();
    await until(async () => (await state()) === 'ready', { timeout: 30000 });
    const keys = await reader(r => r.root.querySelectorAll('.s.k').length);
    assert.ok(keys > 5, `only ${keys} key sentences`);
    assert.ok(fake.seen.responses.length > asked, 'ChatGPT wasn’t asked');
    assert.equal(fake.seen.bearers.at(-1), `Bearer ${decodeHandoff(handoff).chatgpt.accessToken}`, 'not the phone’s own sign-in');
    assert.equal(await reader(r => r.article.meta.title), 'On reading long things');
    await picture(page, `app-${engine}-reader`);
  });

  await check(`on an iPhone (${engine}), Skim keeps the key sentences without scrolling`, async () => {
    await page.locator('.lens button[data-lens="skim"]').tap();
    await page.waitForTimeout(2600);
    assert.ok(await reader(r => r.root.classList.contains('skimming')));
  });

  await check(`on an iPhone (${engine}), closing goes back to the library, and opening again reads nothing`, async () => {
    await page.locator('.close').tap();
    await page.waitForSelector('.library .row');
    assert.match(await page.textContent('.row'), /Key sentences ready/);
    // The reader fades out over the library.
    await page.waitForTimeout(700);
    await picture(page, `app-${engine}-library`);
    const asked = fake.seen.responses.length;
    await page.locator('.row-open').tap();
    // Ready from the saved notes, not from the read before.
    await until(() => reader(r => r.ai.state === 'ready' && r.ai.cached === true));
    assert.equal(fake.seen.responses.length, asked);
  });

  await check(`on an iPhone (${engine}), a run-out sign-in renews itself`, async () => {
    const renewals = fake.seen.token.filter(form => form.grant_type === 'refresh_token').length;
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('spine', 1);
          open.onsuccess = () => {
            const store = open.result.transaction('secrets', 'readwrite').objectStore('secrets');
            const get = store.get('chatgpt');
            get.onsuccess = () => {
              store.put({ ...get.result, expiresAt: 0 }, 'chatgpt').onsuccess = resolve;
            };
            get.onerror = reject;
          };
          open.onerror = reject;
        }),
    );
    await reader(r => r.read(true));
    const renewed = () => fake.seen.token.filter(form => form.grant_type === 'refresh_token');
    await until(async () => renewed().length > renewals, { timeout: 30000 });
    await until(async () => (await state()) === 'ready', { timeout: 30000 });
    const after = renewed();
    assert.equal(after.length, renewals + 1);
    assert.equal(after.at(-1).client_id, decodeHandoff(handoff).chatgpt.clientId);
  });

  await check(`on an iPhone (${engine}), a sign-in OpenAI turns down asks to connect again, and pasting again reads`, async () => {
    // A sign-in ChatGPT has ended: neither token works any more.
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('spine', 1);
          open.onsuccess = () => {
            const store = open.result.transaction('secrets', 'readwrite').objectStore('secrets');
            const get = store.get('chatgpt');
            get.onsuccess = () => {
              const ended = { ...get.result, accessToken: 'at-ended', refreshToken: 'ended', expiresAt: Date.now() + 3600000, models: null };
              store.put(ended, 'chatgpt').onsuccess = resolve;
            };
            get.onerror = reject;
          };
          open.onerror = reject;
        }),
    );
    await reader(r => r.read(true));
    await until(() => reader(r => r.ai.state === 'error' && r.ai.code === 'chatgpt-signin'), { timeout: 20000 });
    await page.locator('button', { hasText: 'Continue with ChatGPT' }).tap();
    await page.waitForSelector('.connect');
    assert.equal(await page.textContent('.connect-title'), 'Connect ChatGPT again');
    await page.fill('.paste-box', handoff);
    // The article it was reading comes back, with its notes.
    await until(() => reader(r => r.layer.isOpen && r.ai.state === 'ready'), { timeout: 30000 });
  });

  await check(`on an iPhone (${engine}), the app runs without errors`, async () => {
    assert.deepEqual(errors, []);
  });
  await phone.close();
}

/* The server */

await check('the server fetches pages only for the owner’s key', async () => {
  const response = await fetch(`${server.origin}/api/fetch?url=${encodeURIComponent(`${fake.url}/article`)}`, {
    headers: { authorization: 'Bearer not-the-key-at-all-sorry' },
  });
  assert.equal(response.status, 401);
});

for (const browser of Object.values(browsers)) await browser.close();
await server.close();
console.log(results.join('\n'));
process.exit(results.some(line => line.startsWith('✗')) ? 1 : 0);
