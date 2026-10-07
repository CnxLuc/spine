// A tour of the reader on an article whose notes are saved in test/.profile:
// each lens, an open pill, a regrouped list, the cards, the panels and the dark
// theme, as screenshots in test/out.
//
//   node test/tour.mjs <url> [name]
import { inReader, launch, shot, toggle } from './browser.mjs';

const url = process.argv[2];
const name = process.argv[3] ?? 'tour';
const { context, worker } = await launch({ persistent: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => message.type() === 'error' && errors.push(message.text()));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1200);
await toggle(worker, page);

const ai = () => inReader(page, (host, shadow) => shadow.querySelector('.spine').dataset.ai);
for (let i = 0; i < 300 && !['ready', 'error', 'no-key'].includes(await ai()); i++) await page.waitForTimeout(1000);
console.log('ai', await ai());

const lens = async id => {
  await inReader(page, (host, shadow, id) => shadow.querySelector(`.lens button[data-lens="${id}"]`).click(), id);
  await page.waitForTimeout(500);
};
const scrollTo = async (selector, offset = 140) => {
  await inReader(page, (host, shadow, [selector, offset]) => {
    const target = shadow.querySelector(selector);
    const scroller = shadow.querySelector('.scroller');
    if (!target) return false;
    scroller.scrollTop += target.getBoundingClientRect().top - offset;
    return true;
  }, [selector, offset]);
  await page.waitForTimeout(700);
};

// Skim, caught mid-scroll: the key sentences hold, the rest fades.
await lens('skim');
await scrollTo('.sec:nth-of-type(3) .sec-title', 120);
await page.waitForTimeout(3000);
await page.mouse.move(720, 500);
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, 60);
  await page.waitForTimeout(70);
}
await page.waitForTimeout(260);
await shot(page, `${name}-skim-scrolling`);
await page.waitForTimeout(4200);
await shot(page, `${name}-skim-rest`);

// Supercut, then a pill resting open.
await lens('supercut');
await page.waitForTimeout(600);
await shot(page, `${name}-supercut`);
const pill = await inReader(page, (host, shadow) => {
  const pills = [...shadow.querySelectorAll('.doc .pill')].filter(p => {
    const r = p.getBoundingClientRect();
    return r.top > 120 && r.bottom < 800 && p.querySelector('.bridge');
  });
  const r = pills[0]?.getBoundingClientRect();
  return r ? { x: r.left + 12, y: r.top + r.height / 2 } : null;
});
if (pill) {
  await page.mouse.move(pill.x, pill.y);
  await page.waitForTimeout(500);
  await shot(page, `${name}-supercut-open`);
  await page.mouse.move(1300, 120);
  await page.waitForTimeout(700);
}

// Outline, from the top and further in.
await lens('outline');
await inReader(page, (host, shadow) => (shadow.querySelector('.scroller').scrollTop = 0));
await page.waitForTimeout(700);
await shot(page, `${name}-outline-top`);
await scrollTo('.sec.foldable:nth-of-type(4)', 90);
await shot(page, `${name}-outline-mid`);

// A regrouped list, its dropdown open.
await lens('read');
const hasRegroup = await inReader(page, (host, shadow) => Boolean(shadow.querySelector('.regroup')));
if (hasRegroup) {
  await scrollTo('.regroup', 260);
  const trigger = await inReader(page, (host, shadow) => {
    const r = shadow.querySelector('.regroup-trigger').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(trigger.x, trigger.y);
  await page.waitForTimeout(400);
  await shot(page, `${name}-regroup-menu`);
  await inReader(page, (host, shadow) => shadow.querySelectorAll('.regroup-option')[1]?.click());
  await page.mouse.move(1300, 120);
  await page.waitForTimeout(500);
  await shot(page, `${name}-regrouped`);
}

// Cards.
await inReader(page, (host, shadow) => {
  const panel = shadow.querySelector('[data-panel="intelligence"]');
  panel.click();
});
await page.waitForTimeout(400);
await shot(page, `${name}-panel-ideas`);
await inReader(page, (host, shadow) => {
  const rows = [...shadow.querySelectorAll('.panel[data-for="intelligence"] .switch-row')];
  rows.find(row => /cards/i.test(row.textContent))?.click();
});
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
if (await inReader(page, (host, shadow) => Boolean(shadow.querySelector('.carousel')))) {
  await scrollTo('.carousel', 300);
  await shot(page, `${name}-cards`);
}

// Panels and the dark theme.
await inReader(page, (host, shadow) => shadow.querySelector('[data-panel="appearance"]').click());
await page.waitForTimeout(400);
await shot(page, `${name}-panel-appearance`);
await inReader(page, (host, shadow) => [...shadow.querySelectorAll('.swatch')].find(s => /Dusk/.test(s.textContent)).click());
await page.keyboard.press('Escape');
await lens('supercut');
await scrollTo('.sec:nth-of-type(2) .sec-title', 120);
await shot(page, `${name}-dusk-supercut`);
await inReader(page, (host, shadow) => [...shadow.querySelectorAll('[data-panel="share"]')][0].click());
await page.waitForTimeout(400);
await shot(page, `${name}-panel-share`);
await page.keyboard.press('Escape');
// Leave the profile as it was found.
await inReader(page, (host, shadow) => {
  shadow.querySelector('[data-panel="appearance"]').click();
});
await page.waitForTimeout(200);
await inReader(page, (host, shadow) => [...shadow.querySelectorAll('.swatch')].find(s => /Auto/.test(s.textContent)).click());
await inReader(page, (host, shadow) => {
  shadow.querySelector('[data-panel="intelligence"]').click();
});
await page.waitForTimeout(200);
await inReader(page, (host, shadow) => {
  const rows = [...shadow.querySelectorAll('.panel[data-for="intelligence"] .switch-row')];
  const cards = rows.find(row => /cards/i.test(row.textContent));
  if (cards?.querySelector('.switch').getAttribute('aria-checked') === 'true') cards.click();
});
await lens('skim');
if (errors.length) console.log(errors.join('\n'));
await context.close();
