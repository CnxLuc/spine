// A picture of the browser's extensions page with Developer mode on and Spine
// loaded, with rings around the two things a reader selects to install the
// download: the Developer mode switch, then Load unpacked. For the website.
//
//   node build.mjs --test && node store/extensions-shot.mjs
import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extension = resolve('.test-build');
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'spine-ext-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 560 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const page = await context.newPage();
await page.goto('chrome://extensions');
await page.waitForTimeout(800);
const toolbar = page.locator('extensions-manager >> extensions-toolbar');
await toolbar.locator('#devMode').click();
await page.waitForTimeout(800);
const boxes = await page.evaluate(() => {
  const bar = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot;
  const rect = element => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  // The test browser's own logo isn't the one readers see; leave it out.
  const hide = root => {
    for (const element of root.querySelectorAll('*')) {
      if (/^(IMG|PICTURE)$/.test(element.tagName) || element.id === 'icon' || element.classList.contains('logo')) element.style.visibility = 'hidden';
      if (element.shadowRoot) hide(element.shadowRoot);
    }
  };
  hide(bar);
  const toggle = rect(bar.querySelector('#devMode'));
  const label = [...bar.querySelectorAll('*')].find(element => element.children.length === 0 && /^\s*Developer mode\s*$/.test(element.textContent));
  const words = label ? rect(label) : toggle;
  return {
    toggle: { x: words.x, y: Math.min(words.y, toggle.y), width: toggle.x + toggle.width - words.x, height: Math.max(words.height, toggle.height) },
    load: rect(bar.querySelector('#loadUnpacked')),
  };
});
// Rings drawn on the page itself, so they sit exactly on the controls.
await page.evaluate(({ toggle, load }) => {
  const ring = ({ x, y, width, height }, label, pad = 7) => {
    const div = document.createElement('div');
    div.style.cssText = `position:fixed;box-sizing:border-box;left:${x - pad}px;top:${y - pad}px;width:${width + pad * 2}px;height:${height + pad * 2}px;border:3px solid #2e637a;border-radius:14px;z-index:99999;pointer-events:none`;
    const badge = document.createElement('span');
    badge.textContent = label;
    badge.style.cssText = 'position:absolute;top:-14px;left:-14px;width:26px;height:26px;border-radius:50%;background:#2e637a;color:#fff;font:600 15px/26px -apple-system,system-ui,sans-serif;text-align:center';
    div.append(badge);
    document.body.append(div);
  };
  ring({ ...toggle, x: toggle.x - 4, width: toggle.width + 4 }, '1');
  ring(load, '2');
}, boxes);
await page.waitForTimeout(300);
await page.screenshot({ path: 'docs/assets/install-extensions.png', clip: { x: 0, y: 0, width: 1100, height: 124 } });
console.log('docs/assets/install-extensions.png', JSON.stringify(boxes));
await context.close();
