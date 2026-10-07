// Checks the published website: every page and asset answers, and the home
// page renders with its fonts, images and demo.
import { chromium } from 'playwright';
const base = 'https://cnxluc.github.io/spine/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
const failed = [];
page.on('response', response => {
  if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
});
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const home = await page.evaluate(async () => ({
  title: document.title,
  font: (await document.fonts.ready, [...document.fonts].some(face => face.family.includes('Newsreader') && face.status === 'loaded')),
  images: [...document.images].map(img => img.complete && img.naturalWidth > 0).filter(Boolean).length + '/' + document.images.length,
  download: document.getElementById('get').href,
  demo: document.querySelector('.demo').dataset.lens,
}));
await page.screenshot({ path: 'test/out/live-home.png' });
const privacy = await (await page.goto(`${base}privacy.html`)).status();
console.log(JSON.stringify({ ...home, privacy, failed }, null, 1));
await browser.close();
