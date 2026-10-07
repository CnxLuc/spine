// Opens Spine on a range of real sites and reports what it found on each, to
// catch pages it reads badly before friends do. No Claude calls.
//
//   node test/sweep.mjs [name ...]
import { inReader, launch, shot, toggle } from './browser.mjs';

// Each site is a page, or an index page and the link to its first article.
const SITES = [
  { name: 'medium', url: 'https://medium.com/@karpathy/software-2-0-a64152b37c35' },
  { name: 'atlantic', url: 'https://www.theatlantic.com/magazine/archive/2008/07/is-google-making-us-stupid/306868/' },
  { name: 'guardian', url: 'https://www.theguardian.com/news/series/the-long-read', pick: 'a[href*="/news/20"], a[href*="/20"][data-link-name*="article"]' },
  { name: 'aeon', url: 'https://aeon.co/essays', pick: 'a[href^="/essays/"]' },
  { name: 'lesswrong', url: 'https://www.lesswrong.com/posts/uMQ3cqWDPHhjtiesc/agi-ruin-a-list-of-lethalities' },
  { name: 'simonw', url: 'https://simonwillison.net/2024/Dec/31/llms-in-2024/' },
  { name: 'substack', url: 'https://www.oneusefulthing.org/archive', pick: 'a[href*="/p/"]' },
  { name: 'lemonde', url: 'https://www.lemonde.fr/idees/', pick: 'a[href*="/article/20"]' },
  { name: 'bbc', url: 'https://www.bbc.com/news', pick: 'a[href*="/news/articles/"]' },
  { name: 'vitalik', url: 'https://vitalik.eth.limo/general/2023/11/27/techno_optimism.html' },
  { name: 'paradigm', url: 'https://www.paradigm.xyz/writing', pick: 'a[href^="/20"]' },
  { name: 'a16zcrypto', url: 'https://a16zcrypto.com/posts/', pick: 'a[href*="/posts/article/"]' },
  { name: 'mirror', url: 'https://mirror.xyz/', pick: 'a[href*="mirror.xyz/"][href*="/0x"], a[href*=".mirror.xyz/"]' },
  { name: 'nyt', url: 'https://www.nytimes.com/section/opinion', pick: 'a[href*="/opinion/20"]' },
];

const only = process.argv.slice(2);
const { context, worker } = await launch();
const rows = [];
for (const site of SITES.filter(site => !only.length || only.includes(site.name))) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning' && /Spine/.test(message.text())) errors.push(message.text());
  });
  let url = site.url;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    if (site.pick) {
      const href = await page.evaluate(selector => {
        const link = [...document.querySelectorAll(selector)].find(a => a.textContent.trim().length > 20);
        return link?.href ?? null;
      }, site.pick);
      if (!href) throw new Error('no article link on the index page');
      url = href;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
    }
    await toggle(worker, page);
    await page.waitForTimeout(1500);
    const stats = await inReader(page, (host, shadow) => {
      if (!shadow) return { error: 'no layer' };
      return {
        empty: Boolean(shadow.querySelector('.empty')),
        title: shadow.querySelector('.doc-title')?.textContent ?? '',
        byline: shadow.querySelector('.doc-byline')?.textContent ?? '',
        dek: shadow.querySelector('.doc-dek')?.textContent ?? '',
        sections: shadow.querySelectorAll('.sec-title').length,
        sentences: new Set([...shadow.querySelectorAll('.s')].map(s => s.dataset.s)).size,
        figures: shadow.querySelectorAll('.doc figure').length,
        brokenFigures: [...shadow.querySelectorAll('.doc figure')].filter(f => f.hidden).length,
        lists: shadow.querySelectorAll('[data-list]').length,
        links: shadow.querySelectorAll('.doc a[href]').length,
        first: shadow.querySelector('.doc-body .tb')?.textContent.slice(0, 90) ?? '',
      };
    });
    await shot(page, `sweep-${site.name}`);
    rows.push({ site: site.name, url, ...stats, errors: errors.slice(0, 2) });
  } catch (error) {
    rows.push({ site: site.name, url, error: error.message.split('\n')[0] });
  }
  await page.close();
}
await context.close();
for (const row of rows) console.log(JSON.stringify(row));
