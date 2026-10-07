// Drives Chromium with Spine loaded, for the end-to-end checks and for looking
// at the reader. Build with `node build.mjs --test` first, so the background
// worker can open Spine on any tab without a click.
import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Connects a test profile to Claude Code and Codex the way the installer
// connects a browser: Chromium finds native messaging hosts in the profile's
// own NativeMessagingHosts folder. claude and codex are the binaries the host
// runs: the real ones, or the fakes in test/fixtures.
export async function connectLocal(profile, { claude = null, codex = null } = {}) {
  const folder = join(profile, 'NativeMessagingHosts');
  await mkdir(folder, { recursive: true });
  const wrapper = join(profile, 'spine-host');
  const lines = ['#!/bin/sh'];
  // An unset tool points at nothing, so the host doesn't find the real one.
  lines.push(`export CLAUDE_BIN="${claude ?? '/nonexistent'}"`, `export CODEX_BIN="${codex ?? '/nonexistent'}"`);
  lines.push(`exec /usr/bin/python3 "${resolve('native/spine_host.py')}"`);
  await writeFile(wrapper, `${lines.join('\n')}\n`, { mode: 0o755 });
  await writeFile(
    join(folder, 'com.spine.local.json'),
    JSON.stringify({
      name: 'com.spine.local',
      description: 'Spine test host',
      path: wrapper,
      type: 'stdio',
      allowed_origins: ['chrome-extension://hbaekihlobpbmhciebgibgeljinadcib/'],
    }),
  );
}

// persistent keeps the profile in test/.profile, where saved notes live between
// runs. claude and codex connect the profile to those binaries.
export async function launch({ headless = true, width = 1440, height = 900, dark = false, persistent = false, claude = null, codex = null } = {}) {
  const extension = resolve('.test-build');
  const profile = persistent ? resolve('test/.profile') : await mkdtemp(join(tmpdir(), 'spine-profile-'));
  if (persistent) {
    await mkdir(profile, { recursive: true });
    // Chromium keeps running a cached copy of an extension's background script
    // after its files change; clear the cache so tests run the current build.
    await rm(join(profile, 'Default', 'Service Worker'), { recursive: true, force: true });
  }
  if (claude || codex) await connectLocal(profile, { claude, codex });
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless,
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: dark ? 'dark' : 'light',
    // Some sites serve headless browsers a different page; look like a person's browser.
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  // Close the welcome tab the extension may open, and wait for it so it can't
  // take over the first page a test opens.
  await new Promise(done => setTimeout(done, 1200));
  for (const page of context.pages()) if (page.url().startsWith('chrome-extension://')) await page.close();
  context.on('page', page => {
    if (page.url().startsWith('chrome-extension://')) page.close().catch(() => {});
  });
  return { context, worker, id, profile };
}

export async function setStorage(worker, area, values) {
  await worker.evaluate(([area, values]) => chrome.storage[area].set(values), [area, values]);
}

// Opens Spine on the page that's in front.
export async function toggle(worker, page) {
  await page.bringToFront();
  await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url === url) ?? (await chrome.tabs.query({ active: true }))[0];
    await globalThis.spineToggle(tab);
  }, page.url());
}

// Runs code in the content script's world, against the reader.
export async function inReader(page, fn, arg) {
  // The content script's globals aren't visible to page.evaluate, so the reader
  // is reached through its shadow root on the page.
  return page.evaluate(
    ([source, arg]) => {
      const host = document.getElementById('spine-reader-host');
      const shadow = host?.shadowRoot;
      return new Function('host', 'shadow', 'arg', `return (${source})(host, shadow, arg);`)(host, shadow, arg);
    },
    [fn.toString(), arg],
  );
}

export async function shot(page, name) {
  await mkdir('test/out', { recursive: true });
  const path = `test/out/${name}.png`;
  await page.screenshot({ path });
  return path;
}
