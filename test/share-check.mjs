// Checks share links end to end. Spine shares articles it has read, through
// the share menu, to the share server running here; each link then opens in a
// browser without Spine, in Spine's reader, and must show what the extension
// shows, lens by lens: the same sentences, key sentences, folds, bridges,
// section notes and lists. Then it checks phones, link previews, sharing again,
// deleting, the key, and a share that carries things it shouldn't.
//
//   node build.mjs --test && node share/build.mjs --test && node test/share-check.mjs
//
// The articles are real pages whose notes are saved in test/.profile, so
// nothing is read again and nothing is spent.
import assert from 'node:assert/strict';
import { chromium, devices, webkit } from 'playwright';
import { launch, setStorage, shot, toggle } from './browser.mjs';
import { startShareServer } from './share-server.mjs';

const ARTICLES = [
  { name: 'dario', url: 'https://darioamodei.com/essay/machines-of-loving-grace' },
  { name: 'graham', url: 'https://paulgraham.com/greatwork.html' },
  { name: 'typo', url: 'https://fr.wikipedia.org/wiki/Typographie' },
  { name: 'altman', url: 'https://blog.samaltman.com/the-merge' },
];
const LENSES = ['read', 'skim', 'supercut', 'outline'];

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}: ${error.message.split('\n').slice(0, 6).join(' / ')}`);
  }
};

// The reader on a page, Spine's or a shared one, through its shadow root.
const reader = (page, fn, arg) =>
  page.evaluate(
    ([source, arg]) => {
      const shadow = document.getElementById('spine-reader-host')?.shadowRoot;
      return new Function('shadow', 'arg', `return (${source})(shadow, arg);`)(shadow, arg);
    },
    [fn.toString(), arg],
  );
const ready = page =>
  page.waitForFunction(
    () => ['ready', 'plain'].includes(document.getElementById('spine-reader-host')?.shadowRoot?.querySelector('.spine')?.dataset.ai),
    null,
    { timeout: 20000 },
  );

// What the reader shows, in a form two readers can be compared by. The article
// itself is compared as markup, without what depends on loading images.
function reading(shadow) {
  const texts = selector => [...shadow.querySelectorAll(selector)].map(element => element.textContent.trim());
  const doc = shadow.querySelector('article.doc').cloneNode(true);
  for (const element of doc.querySelectorAll('*')) {
    element.removeAttribute('style');
    element.removeAttribute('data-loaded');
    element.removeAttribute('hidden');
    element.classList.remove('wide', 'fresh');
    if (!element.classList.length) element.removeAttribute('class');
  }
  // The footer says where the piece came from, and on a shared page who shared it.
  doc.querySelector('.shared-by')?.remove();
  // Some sites don't let other sites show their icon (Cross-Origin-Resource-Policy).
  doc.querySelector('.kicker .favicon')?.remove();
  return {
    lens: shadow.querySelector('.spine').dataset.lens,
    sentences: new Set([...shadow.querySelectorAll('.s')].map(s => s.dataset.s)).size,
    keys: [...new Set([...shadow.querySelectorAll('.s.k')].map(s => s.dataset.s))].join(','),
    pills: texts('.pill').join('|'),
    notes: texts('.callout-text').join('|'),
    headings: texts('.sec-title').join('|'),
    regroup: shadow.querySelectorAll('.regroup').length,
    cards: shadow.querySelectorAll('.carousel').length,
    times: texts('.lens button small').join('|'),
    markup: doc.innerHTML,
  };
}

// The top bar slides away while you read; reaching for the top brings it back.
async function openShare(page) {
  await page.mouse.move(700, 12);
  await page.waitForTimeout(300);
  await page.locator('button[data-panel="share"]').click();
}

async function setLens(page, lens) {
  // So does the dock, from the bottom.
  await page.mouse.move(700, page.viewportSize().height - 30);
  await page.waitForTimeout(300);
  await page.locator(`.lens button[data-lens="${lens}"]`).click();
  await page.waitForTimeout(350);
}

const server = await startShareServer();
const { context, worker } = await launch({ persistent: true });
await setStorage(worker, 'local', { shareKey: server.key, shareServer: server.origin });
// Links from an earlier run point at a server that's gone.
await worker.evaluate(async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(name => name.startsWith('share:')));
});
// The tests compare lens by lens, with the reader's own defaults on both sides.
await worker.evaluate(() => chrome.storage.sync.clear());
const viewer = await chromium.launch();
const desk = await viewer.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const shared = {};

for (const article of ARTICLES) {
  const page = await context.newPage();
  await page.goto(article.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);
  await toggle(worker, page);
  await ready(page);

  await check(`${article.name}: Spine shares it from the share menu`, async () => {
    await openShare(page);
    await page.locator('.panel[data-for="share"] button', { hasText: 'Share a link' }).click();
    await page.waitForFunction(
      () => /^Link copied|^The link is ready/.test(document.getElementById('spine-reader-host').shadowRoot.querySelector('.toast').textContent),
      null,
      { timeout: 15000 },
    );
    const saved = await worker.evaluate(async url => {
      const all = await chrome.storage.local.get(null);
      return Object.entries(all).find(([name]) => name.startsWith('share:') && name.includes(new URL(url).hostname))?.[1];
    }, article.url);
    assert.ok(saved?.url?.startsWith(`${server.origin}/`), 'a link on the share server');
    shared[article.name] = saved.url;
  });
  const link = shared[article.name];
  if (!link) {
    await page.close();
    continue;
  }

  const visit = await desk.newPage();
  const errors = [];
  visit.on('pageerror', error => errors.push(error.message));
  visit.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  await visit.goto(link);

  await check(`${article.name}: the link opens in Spine’s reader with the notes`, async () => {
    await ready(visit);
    assert.equal(await reader(visit, shadow => shadow.querySelector('.spine').dataset.ai), 'ready');
    assert.equal(await reader(visit, shadow => getComputedStyle(shadow.querySelector('.close')).display), 'none');
  });

  for (const lens of LENSES) {
    await check(`${article.name}: ${lens} shows what the extension shows`, async () => {
      await setLens(page, lens);
      await setLens(visit, lens);
      const [mine, theirs] = await Promise.all([reader(page, reading), reader(visit, reading)]);
      assert.ok(mine.sentences > 20, 'the extension has the article');
      const { markup: a, ...restA } = mine;
      const { markup: b, ...restB } = theirs;
      assert.deepEqual(restB, restA);
      if (a !== b) {
        const at = [...a].findIndex((character, index) => character !== b[index]);
        const around = text => JSON.stringify(text.slice(Math.max(0, at - 120), at + 120));
        assert.fail(`markup differs at ${at}: ${around(a)} vs ${around(b)}`);
      }
    });
  }

  await check(`${article.name}: a pill opens and the outline opens a section, on the shared page`, async () => {
    await setLens(visit, 'supercut');
    const pill = visit.locator('.pill').first();
    if (await pill.count()) {
      await pill.click();
      assert.ok(await reader(visit, shadow => shadow.querySelector('.pill').classList.contains('open')));
    }
    await setLens(visit, 'outline');
    const callout = visit.locator('.sec.foldable .callout').first();
    if (await callout.count()) {
      await callout.click();
      await visit.waitForTimeout(300);
      assert.ok(await reader(visit, shadow => Boolean(shadow.querySelector('.sec.open'))));
    }
  });

  await check(`${article.name}: the shared page runs without errors`, async () => {
    assert.deepEqual(errors, []);
  });

  await check(`${article.name}: link previews get its title and a summary`, async () => {
    const html = await (await fetch(link)).text();
    const meta = name => html.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`))?.[1];
    const title = await reader(visit, shadow => shadow.querySelector('.doc-title').textContent);
    const unescape = text => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(unescape(meta('og:title')), title);
    assert.ok((meta('og:description') ?? '').length > 40, 'a summary');
    assert.match(meta('robots'), /noindex/);
  });

  if (article.name === 'dario') {
    await shot(page, 'share-extension');
    await setLens(visit, 'skim');
    await visit.locator('.scroller').evaluate(element => element.scrollTo(0, 0));
    await visit.waitForTimeout(300);
    await shot(visit, 'share-desktop');
  }
  await visit.close();
  await page.close();
}

// On a phone the top bar and the dock come back when you scroll up a little.
async function reach(page) {
  await page.locator('.scroller').evaluate(async element => {
    for (let step = 0; step < 4; step++) {
      element.scrollBy(0, -30);
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    }
  });
  await page.waitForTimeout(350);
}

// Phones: the page fits, the dock stays on screen, and taps open folds.
for (const [engine, browser] of [['chromium', viewer], ['webkit', await webkit.launch()]]) {
  await check(`on a phone (${engine}), the shared page fits and works by touch`, async () => {
    const phone = await browser.newContext({ ...devices['iPhone 14'] });
    const page = await phone.newPage();
    await page.goto(shared.dario);
    await ready(page);
    await page.waitForTimeout(800);
    await shot(page, `share-phone-${engine}-top`);
    const fit = await reader(page, shadow => {
      const scroller = shadow.querySelector('.scroller');
      const dock = shadow.querySelector('.lens').getBoundingClientRect();
      const bar = shadow.querySelector('.bar-right').getBoundingClientRect();
      return {
        wide: scroller.scrollWidth - scroller.clientWidth,
        dock: [Math.round(dock.left), Math.round(dock.right), Math.round(dock.bottom)],
        bar: Math.round(bar.right),
        width: innerWidth,
        height: innerHeight,
      };
    });
    assert.ok(fit.wide <= 1, `no sideways scroll (${fit.wide}px too wide)`);
    assert.ok(fit.dock[0] >= 0 && fit.dock[1] <= fit.width && fit.dock[2] <= fit.height, `the dock is on screen: ${fit.dock} in ${fit.width}×${fit.height}`);
    assert.ok(fit.bar <= fit.width, 'the top bar fits');
    await page.locator('.lens button[data-lens="supercut"]').tap();
    await page.waitForTimeout(400);
    await page.locator('.pill').first().tap();
    await page.waitForTimeout(400);
    assert.ok(await reader(page, shadow => shadow.querySelector('.pill').classList.contains('open')), 'a tap opens a pill');
    await shot(page, `share-phone-${engine}-supercut`);
    await reach(page);
    await page.locator('.lens button[data-lens="outline"]').tap();
    await page.waitForTimeout(500);
    await shot(page, `share-phone-${engine}-outline`);
    await page.locator('.scroller').evaluate(element => element.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.locator('button[data-panel="share"]').tap();
    await page.waitForTimeout(300);
    await shot(page, `share-phone-${engine}-menu`);
    await phone.close();
  });
}

// Settings stay with whoever reads, in their browser.
await check('a reader’s theme stays on the shared page when it opens again', async () => {
  const page = await desk.newPage();
  await page.goto(shared.altman);
  await ready(page);
  await page.keyboard.press('t');
  const theme = await reader(page, shadow => shadow.querySelector('.spine').dataset.theme);
  await page.reload();
  await ready(page);
  assert.equal(await reader(page, shadow => shadow.querySelector('.spine').dataset.theme), theme);
  await page.close();
});

// Sharing again, and stopping.
await check('sharing an unchanged article again keeps its link and uploads nothing', async () => {
  const page = await context.newPage();
  await page.goto(ARTICLES[3].url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await toggle(worker, page);
  await ready(page);
  const before = server.shares.size;
  await openShare(page);
  await page.locator('.panel[data-for="share"] button', { hasText: 'Copy the share link' }).click();
  await page.waitForFunction(() => /^Link copied|^The link is ready/.test(document.getElementById('spine-reader-host').shadowRoot.querySelector('.toast').textContent));
  assert.equal(server.shares.size, before);
  // Stop sharing: the page goes, and the menu offers a new link.
  await openShare(page);
  await page.locator('.panel[data-for="share"] button', { hasText: 'Stop sharing' }).click();
  await page.waitForFunction(() => /^Link deleted/.test(document.getElementById('spine-reader-host').shadowRoot.querySelector('.toast').textContent));
  assert.equal((await fetch(shared.altman)).status, 404);
  await openShare(page);
  assert.equal(await page.locator('.panel[data-for="share"] button', { hasText: 'Share a link' }).count(), 1);
  await page.close();
});

await check('only the key makes links', async () => {
  const post = headers => fetch(`${server.origin}/api/share`, { method: 'POST', headers, body: '{}' });
  assert.equal((await post({})).status, 401);
  assert.equal((await post({ authorization: 'Bearer not-the-key-at-all-no' })).status, 401);
  assert.equal((await post({ authorization: `Bearer ${server.key}` })).status, 400, 'with the key, an empty share is refused');
});

await check('a share carrying scripts, frames and odd links shows only the text', async () => {
  const hostile = {
    v: 1,
    fingerprint: 'none',
    article: {
      meta: { title: 'A <script>bad</script> title', url: 'https://example.com/a', siteName: 'Example', host: 'example.com', lang: 'en', dir: 'ltr', favicon: '', excerpt: '', published: '', byline: '' },
      blocks: [
        '<p>The first sentence is here to read. <img src="x" onerror="window.__pwned = 1"><a href="javascript:window.__pwned = 2">a link</a></p>',
        '<script>window.__pwned = 3</script>',
        '<p style="position:fixed;inset:0" onclick="window.__pwned = 4">Another sentence follows it. <iframe src="https://example.com"></iframe></p>',
        '<div class="table-wrap evil"><svg onload="window.__pwned = 5"></svg><p>A third sentence ends it.</p></div>',
      ],
      words: 18,
    },
    notes: null,
  };
  const reply = await fetch(`${server.origin}/api/share`, {
    method: 'POST',
    headers: { authorization: `Bearer ${server.key}`, 'content-type': 'application/json' },
    body: JSON.stringify(hostile),
  });
  const { url } = await reply.json();
  const page = await desk.newPage();
  await page.goto(url);
  await ready(page);
  await page.waitForTimeout(500);
  const seen = await reader(page, shadow => {
    const doc = shadow.querySelector('article.doc');
    return {
      pwned: window.__pwned ?? null,
      scripts: document.querySelectorAll('script').length,
      title: document.title,
      bad: doc.querySelectorAll('script, iframe, svg, [onerror], [onclick], [onload], [style]').length,
      href: doc.querySelector('.doc-body a')?.getAttribute('href') ?? null,
      text: [...doc.querySelectorAll('.sec-body p')].map(p => p.textContent.trim()).join(' / '),
      ai: shadow.querySelector('.spine').dataset.ai,
    };
  });
  assert.deepEqual(seen, {
    pwned: null,
    scripts: 2,
    title: 'A <script>bad</script> title',
    bad: 0,
    href: null,
    text: 'The first sentence is here to read. a link / Another sentence follows it. / A third sentence ends it.',
    ai: 'plain',
  }, JSON.stringify(seen));
  await page.close();
});

await viewer.close();
await context.close();
await server.close();
console.log(results.join('\n'));
process.exit(results.some(line => line.startsWith('✗')) ? 1 : 0);
