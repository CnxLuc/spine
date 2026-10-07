// Captures the reader for the Chrome Web Store screenshots, from articles whose
// notes are saved in test/.profile (run test/ai.mjs on them first).
//
//   node build.mjs --test && node store/capture.mjs
import { mkdir } from 'node:fs/promises';
import { inReader, launch, toggle } from '../test/browser.mjs';

const RAW = 'store/raw';
await mkdir(RAW, { recursive: true });

async function open(url, { dark = false } = {}) {
  const { context, worker } = await launch({ persistent: true, width: 1280, height: 760, dark });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  await toggle(worker, page);
  for (let i = 0; i < 40; i++) {
    if ((await inReader(page, (h, shadow) => shadow.querySelector('.spine').dataset.ai)) === 'ready') break;
    await page.waitForTimeout(500);
  }
  // Start each capture from the same, quiet state.
  await inReader(page, (h, shadow) => {
    const spine = shadow.querySelector('.spine');
    spine.querySelector('.status').hidden = true;
    shadow.querySelector('.toast')?.classList.remove('shown');
  });
  return { context, page };
}
const lens = (page, id) => inReader(page, (h, shadow, id) => shadow.querySelector(`.lens button[data-lens="${id}"]`).click(), id);
const scrollTo = (page, selector, offset) =>
  inReader(page, (h, shadow, [selector, offset]) => {
    const target = shadow.querySelector(selector);
    const scroller = shadow.querySelector('.scroller');
    scroller.scrollTop += target.getBoundingClientRect().top - offset;
  }, [selector, offset]);
// Picks a theme the way a reader would, so the panel agrees with the page.
async function theme(page, label, { keepOpen = false } = {}) {
  await inReader(page, (h, shadow) => shadow.querySelector('[data-panel="appearance"]').click());
  await page.waitForTimeout(250);
  await inReader(page, (h, shadow, label) => [...shadow.querySelectorAll('.swatch')].find(s => s.textContent.includes(label)).click(), label);
  await page.waitForTimeout(400);
  if (!keepOpen) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}
const quiet = page =>
  inReader(page, (h, shadow) => {
    shadow.querySelector('.toast')?.classList.remove('shown');
    shadow.querySelector('.status').hidden = true;
    shadow.querySelector('.spine').classList.remove('bar-away', 'dock-away');
  });

const DARIO = 'https://darioamodei.com/essay/machines-of-loving-grace';
const PG = 'https://paulgraham.com/greatwork.html';

{
  const { context, page } = await open(DARIO);
  await theme(page, 'Paper');

  // Skim, mid-scroll.
  await lens(page, 'skim');
  await scrollTo(page, '.sec:nth-of-type(3) .sec-title', 40);
  await page.waitForTimeout(3200);
  await page.mouse.move(640, 420);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(420);
  await inReader(page, (h, shadow) => shadow.querySelector('.spine').classList.remove('bar-away', 'dock-away'));
  await page.screenshot({ path: `${RAW}/skim.png` });

  // Supercut, with bridges.
  await page.mouse.move(1270, 380);
  await page.waitForTimeout(3000);
  await lens(page, 'supercut');
  await scrollTo(page, '.sec:nth-of-type(2) .sec-title', 70);
  await page.waitForTimeout(800);
  await quiet(page);
  await page.screenshot({ path: `${RAW}/supercut.png` });

  // Outline, two sections folded under their notes.
  await lens(page, 'outline');
  await page.waitForTimeout(500);
  await scrollTo(page, '.sec:nth-of-type(4) .sec-title', 60);
  await page.waitForTimeout(900);
  await quiet(page);
  await page.screenshot({ path: `${RAW}/outline.png` });

  // A list, and other ways to group it.
  await lens(page, 'read');
  await scrollTo(page, '.regroup', 260);
  await page.waitForTimeout(500);
  const trigger = await inReader(page, (h, shadow) => {
    const r = shadow.querySelector('.regroup-trigger').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(trigger.x, trigger.y);
  await page.waitForTimeout(500);
  await quiet(page);
  await page.screenshot({ path: `${RAW}/lists.png` });
  await context.close();
}

{
  // Dusk, with the appearance panel open.
  const { context, page } = await open(PG, { dark: true });
  await lens(page, 'supercut');
  await scrollTo(page, '.sec:nth-of-type(2) .sec-title', 90);
  await page.waitForTimeout(600);
  await theme(page, 'Dusk', { keepOpen: true });
  await quiet(page);
  await page.screenshot({ path: `${RAW}/dusk.png` });
  await page.keyboard.press('Escape');
  await theme(page, 'Auto');
  await context.close();
}
console.log('captured');
