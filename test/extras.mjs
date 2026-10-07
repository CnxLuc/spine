// Checks the parts the tours don't: a narrow window, the lightbox, and what the
// copy actions put on the clipboard. Uses notes saved in test/.profile.
//
//   node test/extras.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { inReader, launch, shot, toggle } from './browser.mjs';

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}: ${error.message.split('\n')[0]}`);
  }
};
const ready = async page => {
  for (let i = 0; i < 60; i++) {
    const state = await inReader(page, (h, shadow) => shadow?.querySelector('.spine')?.dataset.ai);
    if (state === 'ready' || state === 'no-key' || state === 'error') return state;
    await page.waitForTimeout(500);
  }
};

// A narrow window, like a browser split beside another app.
{
  const { context, worker } = await launch({ persistent: true, width: 760, height: 900 });
  const page = await context.newPage();
  await page.goto('https://darioamodei.com/essay/machines-of-loving-grace', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await toggle(worker, page);
  await ready(page);
  await check('a narrow window keeps the dock and bar inside it', async () => {
    const boxes = await inReader(page, (h, shadow) => {
      const box = selector => {
        const r = shadow.querySelector(selector).getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      return { dock: box('.lens'), bar: box('.bar'), doc: box('.doc'), width: innerWidth, rail: shadow.querySelector('.rail').getClientRects().length };
    });
    assert.ok(boxes.dock.left >= 0 && boxes.dock.right <= boxes.width, `dock ${JSON.stringify(boxes.dock)}`);
    assert.ok(boxes.doc.right <= boxes.width);
    assert.equal(boxes.rail, 0, 'the rail should hide');
  });
  await page.keyboard.press('3');
  await page.waitForTimeout(400);
  await shot(page, 'narrow-supercut');
  await context.close();
}

// The lightbox, on an article with pictures.
{
  const { context, worker } = await launch({ persistent: true });
  const page = await context.newPage();
  await page.goto('https://en.wikipedia.org/wiki/Typography', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await toggle(worker, page);
  await page.waitForTimeout(1200);
  await check('clicking a picture opens it full screen, and a click closes it', async () => {
    const point = await inReader(page, (h, shadow) => {
      const img = [...shadow.querySelectorAll('.doc figure img')].find(i => i.getBoundingClientRect().top > 100 && i.getBoundingClientRect().top < 600);
      const r = img.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(500);
    assert.ok(await inReader(page, (h, shadow) => !shadow.querySelector('.lightbox').hidden));
    await shot(page, 'lightbox');
    await page.mouse.click(40, 40);
    await page.waitForTimeout(400);
    assert.ok(await inReader(page, (h, shadow) => shadow.querySelector('.lightbox').hidden));
  });
  await context.close();
}

// What the copy actions copy.
{
  const { context, worker } = await launch({ persistent: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://darioamodei.com' });
  const page = await context.newPage();
  await page.goto('https://darioamodei.com/essay/machines-of-loving-grace', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await toggle(worker, page);
  await ready(page);
  const copy = async label => {
    await inReader(page, (h, shadow) => shadow.querySelector('[data-panel="share"]').click());
    await page.waitForTimeout(250);
    await inReader(page, (h, shadow, label) => [...shadow.querySelectorAll('.panel[data-for="share"] .menu button')].find(b => b.textContent.includes(label)).click(), label);
    await page.waitForTimeout(400);
    return page.evaluate(() => navigator.clipboard.readText());
  };
  await check('the supercut copies as Markdown with bridges', async () => {
    const text = await copy('Copy the supercut');
    await writeFile('test/out/supercut.md', text);
    assert.match(text, /^# Machines of Loving Grace/);
    assert.match(text, /\*\[[^\]]+\]\*/);
    assert.match(text, /## 1\. Biology and health/);
  });
  await check('the outline copies each section with its note', async () => {
    const text = await copy('Copy the outline');
    await writeFile('test/out/outline.md', text);
    assert.match(text, /## 2\. Neuroscience and mind\n\n.{40,}/);
  });
  await check('the whole article copies as Markdown', async () => {
    const text = await copy('Copy as Markdown');
    await writeFile('test/out/article.md', text);
    assert.ok(text.length > 40000, `only ${text.length} characters`);
    assert.match(text, /- \*\*Avoid grandiosity\*\*/);
  });
  await context.close();
}

// Pictures come along in the Markdown.
{
  const { context, worker } = await launch({ persistent: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://en.wikipedia.org' });
  const page = await context.newPage();
  await page.goto('https://en.wikipedia.org/wiki/Typography', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await toggle(worker, page);
  await page.waitForTimeout(1500);
  await check('an article’s pictures copy as Markdown images', async () => {
    const pictures = await inReader(page, (h, shadow) => shadow.querySelectorAll('.doc figure img').length);
    await inReader(page, (h, shadow) => shadow.querySelector('[data-panel="share"]').click());
    await page.waitForTimeout(250);
    await inReader(page, (h, shadow) => [...shadow.querySelectorAll('.panel[data-for="share"] .menu button')].find(b => b.textContent.includes('Copy as Markdown')).click());
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const images = text.match(/!\[[^\]]*\]\(https?:[^)]+\)/g) ?? [];
    assert.ok(pictures > 3, `only ${pictures} pictures`);
    assert.ok(images.length >= pictures, `${images.length} images for ${pictures} pictures`);
    assert.ok(!images.some(image => /\/wiki\/File:/.test(image)), 'an image points at a page');
  });
  await context.close();
}

// Nothing is sent before the reader agrees, and the reader sees what it will
// cost. A dead API address that isn't on this computer stands in for
// Anthropic, so Spine prices it as API credits and no request can reach Claude.
{
  const { context, worker } = await launch();
  await worker.evaluate(() => chrome.storage.local.set({ apiKey: 'test-key', baseURL: 'http://0.0.0.0:9' }));
  const page = await context.newPage();
  const sent = [];
  context.on('request', request => {
    if (request.url().includes(':9/')) sent.push(request.url());
  });
  await page.goto('https://paulgraham.com/greatwork.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await toggle(worker, page);
  await page.waitForTimeout(1200);
  const state = () => inReader(page, (h, shadow) => shadow.querySelector('.spine').dataset.ai);
  const status = () => inReader(page, (h, shadow) => shadow.querySelector('.status').textContent);
  await check('Spine asks before sending an article, with what it will cost', async () => {
    assert.equal(await state(), 'consent');
    const ask = await status();
    assert.match(ask, /billed to your API credits/);
    assert.match(ask, /This one: about (\d+¢|\$\d+\.\d\d)/);
    await shot(page, 'consent');
    await inReader(page, (h, shadow) => [...shadow.querySelectorAll('.status button')].find(b => b.textContent === 'Not now').click());
    await page.waitForTimeout(300);
    assert.equal(await state(), 'paused');
    const stored = await worker.evaluate(() => chrome.storage.local.get('consent'));
    assert.equal(stored.consent, undefined, 'Not now must not store consent');
    assert.equal(sent.length, 0, 'nothing may be sent before the reader agrees');
  });
  await check('agreeing starts reading and is remembered', async () => {
    await inReader(page, (h, shadow) => shadow.querySelector('[data-panel="intelligence"]').click());
    await page.waitForTimeout(250);
    const panel = await inReader(page, (h, shadow) => shadow.querySelector('.panel[data-for="intelligence"]').textContent);
    assert.match(panel, /of your API credits/);
    await inReader(page, (h, shadow) => [...shadow.querySelectorAll('.panel[data-for="intelligence"] .button')].find(b => b.textContent === 'Read with Claude').click());
    await page.waitForTimeout(400);
    // Paused leads to Read with Claude in the panel, which asks first.
    if ((await state()) === 'consent') {
      await inReader(page, (h, shadow) => shadow.querySelector('.status button.yes').click());
    }
    for (let i = 0; i < 40 && !['error', 'ready'].includes(await state()); i++) await page.waitForTimeout(300);
    assert.equal(await state(), 'error', 'it should have tried, and failed against the dead address');
    const stored = await worker.evaluate(() => chrome.storage.local.get('consent'));
    assert.equal(stored.consent?.version, 1);
  });
  await context.close();
}

// A read over the spending limit waits for a yes.
{
  const { context, worker } = await launch();
  await worker.evaluate(() => {
    chrome.storage.local.set({ apiKey: 'test-key', baseURL: 'http://0.0.0.0:9', consent: { version: 1, at: Date.now() } });
    chrome.storage.sync.set({ askAbove: 0.25 });
  });
  const page = await context.newPage();
  const sent = [];
  context.on('request', request => {
    if (request.url().includes(':9/')) sent.push(request.url());
  });
  await page.goto('https://paulgraham.com/greatwork.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await toggle(worker, page);
  await page.waitForTimeout(1200);
  const state = () => inReader(page, (h, shadow) => shadow.querySelector('.spine').dataset.ai);
  await check('a long article over the limit waits for a yes', async () => {
    assert.equal(await state(), 'confirm');
    const ask = await inReader(page, (h, shadow) => shadow.querySelector('.status').textContent);
    assert.match(ask, /A long one: reading it costs about \d+¢ of your API credits/);
    assert.equal(sent.length, 0);
    await shot(page, 'confirm');
    await inReader(page, (h, shadow) => shadow.querySelector('.status button.yes').click());
    for (let i = 0; i < 40 && !['error', 'ready'].includes(await state()); i++) await page.waitForTimeout(300);
    assert.equal(await state(), 'error', 'after a yes it should have tried');
  });
  await context.close();
}

// Settings add up what reading has cost.
{
  const { context, worker, id } = await launch();
  await worker.evaluate(() =>
    chrome.storage.local.set({
      'notes:https://example.com/a': { v: 1, billing: 'api', cost: 0.41, notes: {} },
      'notes:https://example.com/b': { v: 1, billing: 'api', cost: 0.06, notes: {} },
      'notes:https://example.com/c': { v: 1, billing: 'plan', cost: 0, notes: {} },
    }),
  );
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForTimeout(600);
  await check('settings show what reading has cost so far', async () => {
    const text = await page.textContent('#saved-count');
    assert.match(text, /3 articles read/);
    assert.match(text, /About 47¢ of API credits so far/);
    const billing = await page.textContent('.billing');
    assert.match(billing, /Claude\.ai Pro or Max subscription can’t pay for it/);
  });
  await page.screenshot({ path: 'test/out/options-billing.png', fullPage: true });
  await context.close();
}

console.log(results.join('\n'));
