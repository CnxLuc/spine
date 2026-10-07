// Reads an article with Claude through Spine, end to end, and records what the
// reader sees as the notes arrive. Uses a lasting profile in test/.profile, so
// notes Claude wrote once are reused on later runs instead of asked for again.
//
//   node test/ai.mjs <url> [name] [--engine=claude-code|codex] [--model=claude-opus-5-5] [--fresh] [--forget]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectLocal, inReader, shot, toggle } from './browser.mjs';

const args = process.argv.slice(2);
const url = args.find(arg => /^https?:/.test(arg));
const name = args.find(arg => !arg.startsWith('-') && arg !== url) ?? 'ai';
const flag = (key, fallback) => args.find(arg => arg.startsWith(`--${key}=`))?.split('=').slice(1).join('=') ?? fallback;
const model = flag('model', 'claude-opus-5-5');

const profile = resolve('test/.profile');
if (args.includes('--fresh')) await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
// Run the current build, not a cached copy of an older background script.
await rm(resolve(profile, 'Default', 'Service Worker'), { recursive: true, force: true });
// Reads through the real Claude Code or Codex on this computer, over native
// messaging. --engine=codex picks Codex.
const engine = flag('engine', 'claude-code');
const which = tool => execFileSync('/bin/zsh', ['-lc', `command -v ${tool}`]).toString().trim();
await connectLocal(profile, { claude: which('claude'), codex: which('codex') });
const extension = resolve('.test-build');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: Number(flag('width', 1440)), height: 900 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
// As a reader who has already agreed to send articles.
await worker.evaluate(
  ([engine, model]) =>
    chrome.storage.local.set({ engine, model, apiKey: '', baseURL: '', consent: { version: 1, at: Date.now() } }),
  [engine, model],
);
// --forget drops the saved notes for this article, so Claude reads it again.
if (args.includes('--forget')) {
  const host = new URL(url).hostname;
  await worker.evaluate(async host => {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter(key => /^(notes|pos):/.test(key) && key.includes(host)));
  }, host);
}
for (const page of context.pages()) if (page.url().startsWith('chrome-extension://')) await page.close();

const page = await context.newPage();
const log = [];
page.on('console', message => log.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', error => log.push(`pageerror: ${error.message}`));
worker.on('console', message => log.push(`worker ${message.type()}: ${message.text()}`));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1200);
await toggle(worker, page);

const started = Date.now();
const state = () =>
  inReader(page, (host, shadow) => {
    const root = shadow.querySelector('.spine');
    return {
      ai: root.dataset.ai,
      lens: root.dataset.lens,
      keys: new Set([...shadow.querySelectorAll('.s.k')].map(s => s.dataset.s)).size,
      sentences: new Set([...shadow.querySelectorAll('.s')].map(s => s.dataset.s)).size,
      pills: shadow.querySelectorAll('.doc .pill').length,
      bridges: shadow.querySelectorAll('.doc .pill .bridge').length,
      foldable: shadow.querySelectorAll('.sec.foldable').length,
      regroups: shadow.querySelectorAll('.regroup').length,
      status: shadow.querySelector('.status')?.textContent,
      dock: [...shadow.querySelectorAll('.lens button')].map(b => `${b.querySelector('b').textContent} ${b.querySelector('small').textContent}`).join(' | '),
    };
  });
let last = '';
let shotAt = 0;
while (Date.now() - started < 8 * 60 * 1000) {
  const now = await state();
  const line = JSON.stringify(now);
  if (line !== last) {
    console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`, line);
    last = line;
  }
  // A picture while key sentences are still arriving.
  if (!shotAt && now.ai === 'reading' && now.keys > 20) {
    shotAt = Date.now();
    await shot(page, `${name}-streaming`);
  }
  if (now.ai === 'ready' || now.ai === 'error' || now.ai === 'no-key') break;
  await page.waitForTimeout(1000);
}
await shot(page, `${name}-ready`);
const relevant = log.filter(line => /error|warn|Spine/i.test(line));
if (relevant.length) console.log(relevant.slice(0, 30).join('\n'));
await context.close();
