// Draws Spine's icon at each size the browser asks for: lines of text on ink,
// one of them bright, like a key sentence coming forward.
import { chromium } from 'playwright';

const big = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="30" fill="#1f1e1d"/>
  <g stroke-linecap="round" stroke-width="10">
    <line x1="31" y1="38" x2="83" y2="38" stroke="#f0eee6" stroke-opacity="0.26"/>
    <line x1="31" y1="58" x2="97" y2="58" stroke="#f0eee6"/>
    <line x1="31" y1="78" x2="89" y2="78" stroke="#f0eee6" stroke-opacity="0.26"/>
    <line x1="31" y1="98" x2="73" y2="98" stroke="#add6e8"/>
  </g>
</svg>`;
const small = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#1f1e1d"/>
  <g stroke-linecap="round" stroke-width="17">
    <line x1="30" y1="38" x2="84" y2="38" stroke="#f0eee6" stroke-opacity="0.32"/>
    <line x1="30" y1="65" x2="98" y2="65" stroke="#f0eee6"/>
    <line x1="30" y1="92" x2="76" y2="92" stroke="#f0eee6" stroke-opacity="0.32"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
// The toolbar sizes fill their square; 48 and 128 keep a transparent margin,
// as the Chrome Web Store asks (a 96px picture inside 128).
for (const size of [16, 32, 48, 128]) {
  const svg = size <= 32 ? small : big;
  const art = size >= 48 ? Math.round(size * 0.75) : size;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}body{display:grid;place-items:center;width:${size}px;height:${size}px}svg{display:block;width:${art}px;height:${art}px}</style>${svg}`,
  );
  await page.screenshot({ path: `static/icons/icon-${size}.png`, omitBackground: true });
}
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>${big}`);
await page.screenshot({ path: 'store/assets/icon-512.png', omitBackground: true });
await browser.close();
console.log('icons written');
