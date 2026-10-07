// Prints the notes Spine saved for an article in the test profile, with the
// key sentences and bridges written out, for judging what Claude chose.
//
//   node test/dump.mjs <url-fragment> [--json]
import { chromium } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fragment = process.argv[2] ?? '';
// Run the current build, not a cached copy of an older background script.
await rm(resolve('test/.profile', 'Default', 'Service Worker'), { recursive: true, force: true });
const extension = resolve('.test-build');
const context = await chromium.launchPersistentContext(resolve('test/.profile'), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
const all = await worker.evaluate(() => chrome.storage.local.get(null));
await context.close();
const entries = Object.entries(all).filter(([key]) => key.startsWith('notes:') && key.includes(fragment));
await mkdir('test/out', { recursive: true });
for (const [key, saved] of entries) {
  console.log(`\n${key}  (${saved.engine ?? 'api'}, ${saved.model}, ${new Date(saved.createdAt).toISOString()})`);
  const { notes, lists, bridges } = saved;
  console.log(`keys ${notes.keySentences.length}, folds ${notes.collapseFolds.join(' ')}, chapters ${notes.chapters.length}`);
  for (const [index, summary] of Object.entries(notes.sections)) console.log(`  §${index}: ${summary}`);
  for (const chapter of notes.chapters) console.log(`  ✦ ${chapter.start} ${chapter.title}: ${chapter.summary}`);
  console.log(`bridges ${Object.keys(bridges ?? {}).length}`);
  for (const text of Object.values(bridges ?? {}).slice(0, 40)) console.log(`  · ${text}`);
  for (const [index, grouping] of Object.entries(lists?.groupings ?? {})) {
    console.log(`  list ${index}: ${grouping.sentence} [${grouping.asWritten}] / ${grouping.by.map(b => `${b.name} → ${b.groups.map(g => `${g[0]}(${g[1].join(',')})`).join('; ')}`).join(' || ')}`);
  }
  for (const [index, carousel] of Object.entries(lists?.carousels ?? {})) console.log(`  cards ${index}: ${carousel.label} — ${carousel.icons.join(', ')}`);
  if (process.argv.includes('--json')) {
    const name = key.replace(/^notes:https?:\/\//, '').replace(/[^\w]+/g, '-').slice(0, 60);
    await writeFile(`test/out/notes-${name}.json`, JSON.stringify(saved, null, 2));
  }
}
