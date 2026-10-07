// Composes the Chrome Web Store images from the captures in store/raw: five
// 1280×800 screenshots with captions, the 440×280 promo tile and the
// 1400×560 marquee. Each is drawn at twice the size and scaled down, which the
// store's exact sizes need and which keeps the text crisp.
//
//   node store/capture.mjs && node store/compose.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = resolve('store/assets');
await mkdir(OUT, { recursive: true });
const font = resolve('static/fonts/Newsreader.ttf');
const italic = resolve('static/fonts/Newsreader-Italic.ttf');
const raw = name => `file://${resolve('store/raw', name)}`;
const icon = `file://${resolve('static/icons/icon-128.png')}`;

const base = `
  @font-face { font-family: 'Newsreader'; src: url('file://${font}'); font-weight: 200 800; }
  @font-face { font-family: 'Newsreader'; src: url('file://${italic}'); font-weight: 200 800; font-style: italic; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    --bg: #f0eee6; --ink: #1f1e1d; --ink-2: #5e5d59; --accent: #2e637a; --line: rgb(31 30 29 / 0.08);
    background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, sans-serif;
    -webkit-font-smoothing: antialiased; overflow: hidden;
  }
  body.dark { --bg: #191817; --ink: #efede5; --ink-2: #b0aea5; --accent: #add6e8; --line: rgb(255 255 255 / 0.08); }
  .serif { font-family: 'Newsreader', Georgia, serif; }
`;

const SHOTS = [
  {
    file: 'skim.png',
    kicker: 'Skim',
    title: 'Scroll, and the spine stays.',
    text: 'The sentences that carry the piece hold while everything else fades. Stop scrolling and it all comes back.',
  },
  {
    file: 'supercut.png',
    kicker: 'Supercut',
    title: 'Read it in half the time.',
    text: 'The rest folds into small pills, each with a line in the author’s voice. Rest on one to open it.',
  },
  {
    file: 'outline.png',
    kicker: 'Outline',
    title: 'The whole piece at a glance.',
    text: 'Each long section folds under a short note in the author’s voice. Open the ones you care about.',
  },
  {
    file: 'lists.png',
    kicker: 'Lists',
    title: 'See a list another way.',
    text: 'Spine names how the author ordered a list and offers other groupings, like “by how sure I am”.',
  },
  {
    file: 'dusk.png',
    kicker: 'Yours',
    title: 'Calm, in any light.',
    text: 'Five themes, three typefaces, your size and width. Images, links and footnotes come along.',
    dark: true,
  },
];

function screenshotPage(shot) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
    body { padding: 52px 64px 0; }
    .kicker { font-size: 14px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
    .head { display: grid; grid-template-columns: 1fr 460px; gap: 40px; align-items: end; height: 108px; }
    h1 { white-space: nowrap; }
    h1 { margin-top: 10px; font-size: 44px; line-height: 1.05; font-weight: 600; letter-spacing: -0.015em; }
    p { font-size: 18px; line-height: 1.45; color: var(--ink-2); padding-bottom: 4px; }
    .frame {
      position: absolute; left: 50%; bottom: -1px; transform: translateX(-50%);
      width: 1060px; height: 630px; overflow: hidden;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 30px 90px rgb(0 0 0 / 0.16), 0 0 0 1px var(--line);
      background: var(--bg);
    }
    .frame img { width: 100%; display: block; }
  </style></head><body class="${shot.dark ? 'dark' : ''}">
    <div class="head">
      <div><div class="kicker">${shot.kicker}</div><h1 class="serif">${shot.title}</h1></div>
      <p>${shot.text}</p>
    </div>
    <div class="frame"><img src="${raw(shot.file)}"></div>
  </body></html>`;
}

// A few lines of text, one of them bright, like the icon and the Skim lens.
const lines = (widths, bright, dark) =>
  widths
    .map(
      (width, index) =>
        `<i style="width:${width}%;background:${index === bright ? (dark ? '#add6e8' : '#2e637a') : dark ? 'rgb(239 237 229 / 0.18)' : 'rgb(31 30 29 / 0.13)'}"></i>`,
    )
    .join('');

function tilePage() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
    body { display: grid; grid-template-columns: 96px 1fr; gap: 22px; align-items: center; padding: 0 34px; }
    img { width: 96px; height: 96px; }
    h1 { font-size: 50px; line-height: 1; font-weight: 600; letter-spacing: -0.02em; }
    p { margin-top: 8px; font-size: 16px; line-height: 1.35; color: var(--ink-2); }
    .lines { display: grid; gap: 7px; margin-top: 18px; }
    .lines i { display: block; height: 6px; border-radius: 3px; }
  </style></head><body>
    <img src="${icon}">
    <div>
      <h1 class="serif">Spine</h1>
      <p>Read the spine of any long article.</p>
      <div class="lines">${lines([92, 70, 84, 58], 1)}</div>
    </div>
  </body></html>`;
}

function marqueePage() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
    body { display: grid; grid-template-columns: 500px 1fr; align-items: center; padding-left: 80px; }
    .brand { display: flex; align-items: center; gap: 18px; }
    .brand img { width: 72px; height: 72px; }
    h1 { font-size: 64px; line-height: 1; font-weight: 600; letter-spacing: -0.02em; }
    h2 { margin-top: 28px; font-size: 34px; line-height: 1.15; font-weight: 500; }
    p { margin-top: 16px; font-size: 18px; line-height: 1.45; color: var(--ink-2); max-width: 400px; }
    .frame {
      align-self: end; margin-left: 30px; height: 470px; overflow: hidden;
      border-radius: 18px 0 0 0;
      box-shadow: 0 30px 90px rgb(0 0 0 / 0.16), 0 0 0 1px var(--line);
    }
    .frame img { height: 100%; display: block; }
  </style></head><body>
    <div>
      <div class="brand"><img src="${icon}"><h1 class="serif">Spine</h1></div>
      <h2 class="serif">Key sentences come forward. Asides fold away.</h2>
      <p>A calm reader for long writing, with Claude finding the spine of each piece in the author’s own words.</p>
    </div>
    <div class="frame"><img src="${raw('skim.png')}"></div>
  </body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
async function render(html, name, width, height) {
  const file = resolve('store/raw', `${name}.html`);
  await writeFile(file, html);
  await page.setViewportSize({ width, height });
  await page.goto(`file://${file}`);
  await page.waitForTimeout(400);
  const big = resolve('store/raw', `${name}@2x.png`);
  await page.screenshot({ path: big });
  // The store wants exact sizes, without transparency.
  execFileSync('sips', ['-z', String(height), String(width), big, '--out', resolve(OUT, `${name}.png`)], { stdio: 'ignore' });
}
for (const [index, shot] of SHOTS.entries()) await render(screenshotPage(shot), `screenshot-${index + 1}-${shot.kicker.toLowerCase()}`, 1280, 800);
await render(tilePage(), 'promo-small-440x280', 440, 280);
await render(marqueePage(), 'promo-marquee-1400x560', 1400, 560);
await browser.close();
console.log('composed');
