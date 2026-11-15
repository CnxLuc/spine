// Pictures of the website in docs/, served at localhost:4788, wide and on a
// phone. Checks nothing scrolls sideways.
//
//   python3 -m http.server 4788 --directory docs & node test/site-shot.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('test/out', { recursive: true });
const browser = await chromium.launch();
for (const [suffix, viewport] of [['', { width: 1360, height: 900 }], ['-phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto('http://localhost:4788/#install');
  await page.waitForTimeout(800);
  await page.locator('#cost').screenshot({ path: `test/out/site-cost${suffix}.png` });
  await page.locator('#install').screenshot({ path: `test/out/site-install${suffix}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(`${suffix || 'wide'}: ${overflow ? `${overflow}px of sideways scroll` : 'no sideways scroll'}`);
  await page.close();
}
await browser.close();
