// Checks Spine reads an X article as X shows it: its own title and author, its
// cover, its headings, and links that stay in their sentences. The article is
// test/fixtures/x-article.html, served at an x.com address.
//
//   node build.mjs --test && node test/x-check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inReader, launch, shot, toggle } from './browser.mjs';

const URL = 'https://x.com/joexample/status/1';
// A 1×1 PNG, so the article's images load.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const { context, worker } = await launch();
const html = await readFile('test/fixtures/x-article.html');
await context.route('**/*', route => {
  const url = route.request().url();
  if (url === URL) return route.fulfill({ contentType: 'text/html', body: html });
  if (url.startsWith('https://pbs.twimg.com/')) return route.fulfill({ contentType: 'image/png', body: PIXEL });
  return route.abort();
});
const page = await context.newPage();
await page.goto(URL);
await toggle(worker, page);
await page.waitForTimeout(1500);
const read = await inReader(page, (host, shadow) => {
  const paragraph = [...shadow.querySelectorAll('.doc p')].find(p => p.textContent.includes('in March we did a'));
  return {
    title: shadow.querySelector('.doc-title')?.textContent,
    byline: shadow.querySelector('.doc-byline .author')?.textContent,
    headings: [...shadow.querySelectorAll('.sec-title')].map(h => h.textContent.trim()),
    figures: shadow.querySelectorAll('.doc figure img').length,
    link: paragraph?.querySelector('a')?.textContent,
    paragraph: paragraph?.textContent.replace(/\s+/g, ' '),
    links: [...shadow.querySelectorAll('.doc a[href^="https://example.com/"]')].map(a => a.textContent),
  };
});
await shot(page, 'x-article');
await context.close();

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}: ${error.message.split('\n')[0]}`);
  }
};
check('the title is the article’s, not the tab’s', () => assert.equal(read.title, 'Two ways to read a market'));
check('the author is the post’s', () => assert.equal(read.byline, 'Jo Example'));
check('the headings are the article’s, without X’s', () => assert.deepEqual(read.headings, ['Market one: a strategic good', 'Market two: an open one']));
check('the cover comes first, once, with the image in the text', () => assert.equal(read.figures, 2));
check('a link stays in its sentence', () => {
  assert.equal(read.link, 'pilot trade with a broker');
  assert.match(read.paragraph, /we did a pilot trade with a broker\. After that, very little\./);
});
check('every link is kept', () => assert.deepEqual(read.links, ['pilot trade with a broker', 'the public indices']));
for (const line of results) console.log(line);
if (results.some(line => line.startsWith('✗'))) process.exit(1);
