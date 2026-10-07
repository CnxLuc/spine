// Pictures of the website in docs/, served at localhost:4788.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('test/out', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4788/#cost');
await page.waitForTimeout(800);
await page.locator('#cost').screenshot({ path: 'test/out/site-cost.png' });
await page.locator('#install').screenshot({ path: 'test/out/site-install.png' });
await browser.close();
console.log('done');
