// Checks the first run: choosing who reads right in the reader, signing in to
// ChatGPT against a stand-in for OpenAI, and connecting Claude Code while the
// card watches for it.
//
//   node build.mjs --test && node test/onboard.mjs
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { connectLocal, inReader, launch, setStorage, shot, toggle } from './browser.mjs';
import { startFakeOpenAI } from './fixtures/fake-openai.mjs';

const FAKE_CLAUDE = resolve('test/fixtures/fake-claude');
// The fake claude writes real-looking notes, so reads in the browser finish.
process.env.FAKE_CLAUDE_READS = '1';

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}: ${error.message.split('\n')[0]}`);
  }
};
const until = async (fn, { timeout = 15000, every = 150 } = {}) => {
  const start = Date.now();
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${fn.toString().replace(/\s+/g, ' ').slice(0, 90)}`);
    await new Promise(done => setTimeout(done, every));
  }
};
const aiState = page => inReader(page, (h, shadow) => shadow?.querySelector('.spine')?.dataset.ai);
const card = page =>
  inReader(page, (h, shadow) => {
    const element = shadow?.querySelector('.who-card');
    return element && !element.hidden ? { mode: element.dataset.mode, text: element.innerText } : null;
  });
const cardIn = (page, mode, pattern = /./) =>
  until(() => card(page).then(shown => shown?.mode === mode && pattern.test(shown.text) && shown));
const status = page =>
  inReader(page, (h, shadow) => {
    const element = shadow.querySelector('.status');
    return element.hidden ? null : element.innerText;
  });
// A picture of the reader once the card and panels have finished arriving.
const picture = async (page, name) => {
  await page.waitForTimeout(500);
  await shot(page, name);
};
const settled = page => until(async () => (await aiState(page)) === 'ready', { timeout: 30000 });

const fake = await startFakeOpenAI();

// A fresh browser pointed at the stand-in, with Spine open on its article.
async function start(options = {}) {
  const browser = await launch(options);
  await setStorage(browser.worker, 'local', { chatgptTest: { issuer: fake.url, api: `${fake.url}/v1` } });
  const page = await browser.context.newPage();
  await page.goto(`${fake.url}/article`);
  await toggle(browser.worker, page);
  return { ...browser, page };
}
// Selects Continue with ChatGPT in the card and returns the sign-in window.
async function continueWithChatGPT({ context, page }) {
  const opened = context.waitForEvent('page');
  await page.locator('.who-card .siwc').click();
  const window = await opened;
  await window.waitForLoadState();
  return window;
}

// A new reader: the card, ChatGPT, the settings page.
{
  const browser = await start();
  const { page } = browser;

  await check('a first article offers ChatGPT and Claude Code, right in the reader', async () => {
    const shown = await cardIn(page, 'choose');
    assert.match(shown.text, /Continue with ChatGPT/);
    assert.match(shown.text, /Use Claude Code/);
    assert.match(shown.text, /sends them the text of the articles you open, and nothing else/);
    await picture(page, 'onboard-choose');
  });

  await check('Continue with ChatGPT signs in, in a small window, and reading starts', async () => {
    const window = await continueWithChatGPT(browser);
    assert.match(await window.textContent('h1'), /Spine wants to use your ChatGPT plan/);
    await cardIn(page, 'chatgptWaiting');
    await picture(page, 'onboard-signing-in');
    await window.click('#allow');
    await until(async () => window.isClosed());
    const welcome = await cardIn(page, 'welcome');
    assert.match(welcome.text, /You’re using your ChatGPT plan/);
    assert.match(welcome.text, /Manage usage/);
    await settled(page);
    const keys = await inReader(page, (h, shadow) => shadow.querySelectorAll('.s.k').length);
    assert.ok(keys > 5, `only ${keys} key sentences`);
    await picture(page, 'onboard-welcome');
  });

  await check('Spine signs in the way OpenAI asks open-source apps to', async () => {
    const [asked] = fake.seen.authorize;
    assert.equal(asked.client_id, 'dynamic_agent_client');
    assert.equal(asked.agent_name_hint, 'Spine');
    assert.match(asked.ext_agent_host_id, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.match(asked.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    assert.equal(asked.scope, 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
    assert.equal(asked.resource, 'https://api.openai.com/v1');
    assert.equal(asked.code_challenge_method, 'S256');
    const [exchange] = fake.seen.token;
    assert.deepEqual([exchange.grant_type, exchange.client_id], ['authorization_code', 'oaiapp_test']);
  });

  await check('reading asks the Responses API the way plan usage requires', async () => {
    const asks = fake.seen.responses;
    assert.ok(asks.some(ask => ask.text.format.name === 'notes'), 'no notes request');
    for (const ask of asks) {
      assert.equal(ask.model, 'gpt-fast');
      assert.equal(ask.store, false);
      assert.equal(ask.stream, true);
      assert.equal(ask.text.format.strict, true);
      assert.ok(ask.instructions.length > 200, 'instructions missing');
      assert.deepEqual(Object.keys(ask.input[0]), ['role', 'content']);
    }
  });

  await check('the sign-in stays out of storage a page script can read', async () => {
    const visible = await browser.worker.evaluate(async () =>
      JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.sync.get(null)]),
    );
    assert.doesNotMatch(visible, /\b(at|rt)-\d+\b/);
    assert.match(visible, /"engine":"chatgpt"/);
  });

  await check('the reading panel says the ChatGPT plan is in use, with Manage usage', async () => {
    await page.locator('.who-card .ob-got').click();
    await page.locator('.tool[data-panel="intelligence"]').click();
    const panel = await until(() =>
      inReader(page, (h, shadow) => {
        const element = shadow.querySelector('.panel[data-for="intelligence"]');
        return !element.hidden && { text: element.innerText, link: element.querySelector('.plan-line a')?.href };
      }),
    );
    assert.match(panel.text, /GPT Fast · .* · on your ChatGPT plan/);
    assert.match(panel.text, /Using ChatGPT plan · Manage usage/);
    assert.equal(panel.link, 'https://chatgpt.com/settings/usage');
    await picture(page, 'onboard-panel');
    await page.keyboard.press('Escape');
  });

  const settings = await browser.context.newPage();
  await settings.goto(`chrome-extension://${browser.id}/options.html`);
  const chatgptStatus = () => settings.evaluate(() => document.getElementById('chatgpt-status').textContent);

  await check('settings show the ChatGPT account and its models', async () => {
    await until(async () => /Signed in as reader@example\.com/.test(await chatgptStatus()));
    await until(async () => (await settings.evaluate(() => document.querySelectorAll('#chatgpt-model option').length)) === 2);
    const models = await settings.evaluate(() => [...document.querySelectorAll('#chatgpt-model option')].map(option => option.textContent));
    assert.deepEqual(models, ['GPT Fast', 'GPT Careful']);
    assert.equal(await settings.evaluate(() => document.querySelector('input[name="engine"]:checked')?.value), 'chatgpt');
    await settings.screenshot({ path: 'test/out/options-chatgpt.png' });
  });

  await check('signing out ends the session with OpenAI', async () => {
    await settings.click('#chatgpt-sign-out');
    await until(async () => /Not signed in/.test(await chatgptStatus()));
    assert.equal(fake.seen.revoke.length, 1);
    assert.match(fake.seen.revoke[0].token, /^rt-\d+$/);
    assert.equal(fake.seen.revoke[0].client_id, 'oaiapp_test');
  });

  await check('signing in again reuses the client OpenAI issued to Spine', async () => {
    const opened = browser.context.waitForEvent('page');
    await settings.click('#chatgpt-sign-in');
    const window = await opened;
    await window.waitForLoadState();
    const again = fake.seen.authorize.at(-1);
    assert.equal(again.client_id, 'oaiapp_test');
    assert.equal(again.agent_name_hint, undefined);
    assert.equal(again.login_hint, 'reader@example.com');
    assert.equal(again.ext_agent_host_id, fake.seen.authorize[0].ext_agent_host_id);
    await window.click('#allow');
    await until(async () => /Signed in as/.test(await chatgptStatus()));
  });
  await browser.context.close();
}

// Changing your mind in the ChatGPT window.
{
  const browser = await start();
  const { page } = browser;
  await cardIn(page, 'choose');

  await check('cancelling in ChatGPT brings the choice back, saying why', async () => {
    const window = await continueWithChatGPT(browser);
    await window.click('#cancel');
    await cardIn(page, 'choose', /You didn’t allow Spine to use your ChatGPT plan/);
  });

  await check('closing the ChatGPT window brings the choice back', async () => {
    const window = await continueWithChatGPT(browser);
    await window.close();
    await cardIn(page, 'choose', /window closed before you signed in/);
  });
  await browser.context.close();
}

// A plan at its limit, with an access token close to running out.
{
  fake.expiresIn = 60;
  fake.limit = true;
  const browser = await start();
  const { page } = browser;
  await cardIn(page, 'choose');
  const before = fake.seen.token.length;

  await check('an access token near its end is renewed before reading', async () => {
    const window = await continueWithChatGPT(browser);
    await window.click('#allow');
    await until(async () => (await aiState(page)) === 'error', { timeout: 20000 });
    const renewals = fake.seen.token.slice(before).filter(form => form.grant_type === 'refresh_token');
    assert.ok(renewals.length >= 1, 'no renewal');
    assert.equal(renewals[0].client_id, 'oaiapp_test');
  });

  await check('a usage limit says so, with Manage usage', async () => {
    const line = await status(page);
    assert.match(line, /Usage limit reached/);
    assert.match(line, /Manage usage/);
    await page.locator('.who-card .ob-got').click();
    await picture(page, 'onboard-limit');
  });
  fake.limit = false;
  fake.expiresIn = 3600;

  await check('a plan OpenAI won’t share says so, and offers another reader', async () => {
    fake.ineligible = true;
    await page.locator('.status button', { hasText: 'Try again' }).click();
    const line = await until(() => status(page).then(text => /Plus and Pro can/.test(text ?? '') && text));
    assert.match(line, /Choose another/);
    await page.locator('.status button', { hasText: 'Choose another' }).click();
    await cardIn(page, 'choose');
    fake.ineligible = false;
  });
  await browser.context.close();
}

// Claude Code: the card shows the command and watches for it.
{
  const browser = await start();
  const { page } = browser;
  await cardIn(page, 'choose');

  await check('Use Claude Code shows the one command, and reads as soon as it’s connected', async () => {
    await page.locator('.who-card .ob-alt').click();
    const waiting = await cardIn(page, 'claudeWaiting', /Paste this into Terminal/);
    assert.match(waiting.text, /curl -fsSL https:\/\/cnxluc\.github\.io\/spine\/connect\.sh \| bash/);
    assert.match(waiting.text, /Waiting for Claude Code/);
    await picture(page, 'onboard-claude');
    await connectLocal(browser.profile, { claude: FAKE_CLAUDE });
    await settled(page);
    assert.equal(await card(page), null);
  });
  await browser.context.close();
}

// Claude Code already connected: the one-line question, one click.
{
  const browser = await start({ claude: FAKE_CLAUDE });
  const { page } = browser;

  await check('with Claude Code already connected, one click reads', async () => {
    const line = await until(() => status(page).then(text => /Read with Claude\?/.test(text ?? '') && text));
    assert.match(line, /on your Claude plan/);
    assert.equal(await card(page), null);
    await page.locator('.status button.yes').click();
    await settled(page);
  });
  await browser.context.close();
}

// How the card looks on a dark page and in a narrow window.
for (const [name, options] of [
  ['onboard-choose-dark', { dark: true }],
  ['onboard-choose-narrow', { width: 480, height: 820 }],
]) {
  const browser = await start(options);
  await check(`the card fits ${options.dark ? 'a dark page' : 'a narrow window'}`, async () => {
    await cardIn(browser.page, 'choose');
    const box = await inReader(browser.page, (h, shadow) => {
      const rect = shadow.querySelector('.who-card').getBoundingClientRect();
      const button = getComputedStyle(shadow.querySelector('.siwc')).backgroundColor;
      return { left: rect.left, right: rect.right, width: innerWidth, button };
    });
    assert.ok(box.left >= 0 && box.right <= box.width, `card ${JSON.stringify(box)}`);
    assert.equal(box.button, options.dark ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
    await picture(browser.page, name);
  });
  await browser.context.close();
}

// Not now.
{
  const browser = await start();
  const { page } = browser;
  await cardIn(page, 'choose');

  await check('not now puts the card away, and later articles only mention it', async () => {
    await page.locator('.who-card .ob-link', { hasText: 'Not now' }).click();
    assert.equal(await card(page), null);
    const other = await browser.context.newPage();
    await other.goto(`${fake.url}/article?another`);
    await toggle(browser.worker, other);
    const line = await until(() => status(other));
    assert.match(line, /Choose who reads/);
    assert.equal(await card(other), null);
  });
  await browser.context.close();
}

await fake.close();
console.log(results.join('\n'));
if (results.some(line => line.startsWith('✗'))) process.exitCode = 1;
