// Checks the reader's interactions on an article whose notes are saved in
// test/.profile, and fails loudly when one doesn't do what it should.
//
//   node test/interact.mjs <url>
import assert from 'node:assert/strict';
import { inReader, launch, shot, toggle } from './browser.mjs';

const url = process.argv[2] ?? 'https://darioamodei.com/essay/machines-of-loving-grace';
const { context, worker } = await launch({ persistent: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1000);
await toggle(worker, page);
for (let i = 0; i < 60; i++) {
  if ((await inReader(page, (h, shadow) => shadow.querySelector('.spine').dataset.ai)) === 'ready') break;
  await page.waitForTimeout(500);
}
const root = () => inReader(page, (h, shadow) => {
  const spine = shadow.querySelector('.spine');
  return {
    lens: spine.dataset.lens,
    theme: spine.dataset.theme,
    classes: spine.className,
    top: shadow.querySelector('.scroller').scrollTop,
    help: !shadow.querySelector('.help').hidden,
    open: shadow.querySelectorAll('.doc .open').length,
    toast: shadow.querySelector('.toast.shown')?.textContent ?? '',
    railNote: shadow.querySelector('.rail-note.shown')?.textContent ?? '',
  };
});
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}: ${error.message.split('\n')[0]}`);
  }
};

await check('number keys switch lenses', async () => {
  await page.keyboard.press('3');
  assert.equal((await root()).lens, 'supercut');
  await page.keyboard.press('1');
  assert.equal((await root()).lens, 'read');
  await page.keyboard.press(']');
  assert.equal((await root()).lens, 'skim');
});

await check('holding ⌥ shows the key sentences', async () => {
  await page.keyboard.press('1');
  await page.keyboard.down('Alt');
  await page.waitForTimeout(100);
  assert.match((await root()).classes, /skimming/);
  await page.keyboard.up('Alt');
  await page.waitForTimeout(100);
  assert.doesNotMatch((await root()).classes, /skimming/);
});

await check('resting on a pill opens it, leaving closes it', async () => {
  await page.keyboard.press('3');
  await inReader(page, (h, shadow) => {
    const scroller = shadow.querySelector('.scroller');
    const pill = [...shadow.querySelectorAll('.doc .pill')].find(p => p.querySelector('.bridge'));
    scroller.scrollTop += pill.getBoundingClientRect().top - 300;
  });
  await page.waitForTimeout(300);
  const box = await inReader(page, (h, shadow) => {
    const pill = [...shadow.querySelectorAll('.doc .pill')].find(p => {
      const r = p.getBoundingClientRect();
      return p.querySelector('.bridge') && r.top > 150 && r.bottom < 800;
    });
    const r = pill.getClientRects()[0];
    return { x: r.left + 8, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x - 40, box.y - 60);
  await page.mouse.move(box.x, box.y, { steps: 4 });
  await page.waitForTimeout(400);
  assert.ok((await root()).open > 0, 'nothing opened');
  await shot(page, 'interact-pill-open');
  await page.mouse.move(1380, 60, { steps: 4 });
  await page.waitForTimeout(700);
  assert.equal((await root()).open, 0);
});

await check('E opens every fold, and again closes them', async () => {
  await page.keyboard.press('e');
  assert.ok((await root()).open > 50);
  await page.keyboard.press('e');
  assert.equal((await root()).open, 0);
});

await check('J jumps to the next section', async () => {
  await page.keyboard.press('1');
  await inReader(page, (h, shadow) => (shadow.querySelector('.scroller').scrollTop = 0));
  await page.waitForTimeout(200);
  await page.keyboard.press('j');
  await page.waitForTimeout(900);
  const first = (await root()).top;
  assert.ok(first > 500, `moved to ${first}`);
  await page.keyboard.press('j');
  await page.waitForTimeout(900);
  assert.ok((await root()).top > first);
});

await check('T changes the theme', async () => {
  const before = (await root()).theme;
  await page.keyboard.press('t');
  await page.waitForTimeout(100);
  assert.notEqual((await root()).theme, before);
  for (let i = 0; i < 5; i++) await page.keyboard.press('t');
  await page.waitForTimeout(100);
});

await check('? shows the shortcuts, Esc closes them', async () => {
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(100);
  assert.ok((await root()).help);
  await shot(page, 'interact-help');
  await page.keyboard.press('Escape');
  assert.ok(!(await root()).help);
});

await check('the rail shows a section’s note on hover', async () => {
  const link = await inReader(page, (h, shadow) => {
    const r = shadow.querySelectorAll('.rail a')[3].getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2 };
  });
  await page.mouse.move(link.x, link.y, { steps: 3 });
  await page.waitForTimeout(300);
  assert.ok((await root()).railNote.length > 40);
  await shot(page, 'interact-rail-note');
  await page.mouse.move(1380, 400);
});

await check('closing and opening again keeps your place', async () => {
  await inReader(page, (h, shadow) => {
    const scroller = shadow.querySelector('.scroller');
    scroller.scrollTop = scroller.scrollHeight * 0.4;
  });
  await page.waitForTimeout(1200);
  const before = (await root()).top;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const hidden = await page.evaluate(() => !document.getElementById('spine-reader-host').matches(':popover-open'));
  assert.ok(hidden, 'still open');
  await toggle(worker, page);
  await page.waitForTimeout(500);
  assert.ok(Math.abs((await root()).top - before) < 5, 'moved');
});

await check('the page underneath doesn’t scroll while Spine is open', async () => {
  const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
  assert.equal(overflow, 'hidden');
});

console.log(results.join('\n'));
if (errors.length) console.log('page errors:', errors.join('\n'));
await context.close();
