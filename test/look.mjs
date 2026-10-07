// Opens a page with Spine and takes screenshots, for looking at the reader.
//
//   node test/look.mjs <url> [name] [--dark] [--width=1440] [--scroll=0.3]
import { launch, shot, toggle, inReader } from './browser.mjs';

const args = process.argv.slice(2);
const url = args.find(arg => /^https?:|^file:/.test(arg));
const name = args.find(arg => !arg.startsWith('-') && arg !== url) ?? 'look';
const flag = (key, fallback) => {
  const found = args.find(arg => arg.startsWith(`--${key}=`));
  return found ? found.split('=')[1] : fallback;
};
const dark = args.includes('--dark');
const width = Number(flag('width', 1440));
const scroll = Number(flag('scroll', 0));

const { context, worker } = await launch({ width, height: Number(flag('height', 900)), dark });
const page = await context.newPage();
const errors = [];
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
worker.on('console', message => errors.push(`worker ${message.type()}: ${message.text()}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1500);
const started = Date.now();
await toggle(worker, page);
await page.waitForTimeout(900);
console.log('opened in', Date.now() - started, 'ms');
const stats = await inReader(page, (host, shadow) => {
  if (!shadow) return { error: 'no layer' };
  const doc = shadow.querySelector('.doc');
  return {
    title: shadow.querySelector('.doc-title')?.textContent,
    sections: shadow.querySelectorAll('.sec').length,
    headings: [...shadow.querySelectorAll('.sec-title')].map(h => h.textContent).slice(0, 12),
    blocks: shadow.querySelectorAll('.tb').length,
    sentences: new Set([...shadow.querySelectorAll('.s')].map(s => s.dataset.s)).size,
    figures: shadow.querySelectorAll('.doc figure').length,
    lists: shadow.querySelectorAll('[data-list]').length,
    byline: shadow.querySelector('.doc-byline')?.textContent,
    empty: Boolean(shadow.querySelector('.empty')),
    lens: shadow.querySelector('.spine')?.dataset.lens,
    ai: shadow.querySelector('.spine')?.dataset.ai,
    height: doc?.scrollHeight,
  };
});
console.log(JSON.stringify(stats, null, 2));
await shot(page, `${name}-top`);
if (scroll) {
  await inReader(page, (host, shadow, ratio) => {
    const scroller = shadow.querySelector('.scroller');
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * ratio;
  }, scroll);
  await page.waitForTimeout(2600);
  await shot(page, `${name}-scrolled`);
}
if (errors.length) console.log(errors.join('\n'));
await context.close();
