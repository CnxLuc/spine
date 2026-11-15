// The page a shared article opens in. Its head is what link previews read; its
// script is Spine's reader, which builds the article from the share the page
// carries, as the extension builds it from the original page.
import { VERSION } from './build.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = text => String(text ?? '').replace(/[&<>"']/g, character => ENTITIES[character]);
const DECODE = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const plain = html =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => DECODE[name])
    .replace(/\s+/g, ' ')
    .trim();
const clip = (text, length) => (text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, '')}…` : text);

// What a preview says about the piece: its subtitle, its first note, or how it opens.
function summaryOf(share) {
  const { meta, blocks } = share.article;
  const note = Object.values(share.notes?.sections ?? {})[0] ?? share.notes?.chapters?.[0]?.summary;
  const opening = blocks.map(plain).find(text => text.split(' ').length >= 12);
  const excerpt = (meta.excerpt ?? '').length >= 40 ? meta.excerpt : '';
  return clip(meta.dek || excerpt || note || opening || '', 280);
}

// The piece's own preview picture, or its first figure.
function imageOf(share) {
  const { meta, blocks } = share.article;
  if (/^https:\/\//.test(meta.image ?? '')) return meta.image;
  for (const block of blocks) {
    const src = block.match(/<figure class="fig[^"]*">(?:<a [^>]*>)?<img src="(https:\/\/[^"]+)"/)?.[1];
    if (src) return src.replace(/&amp;/g, '&');
  }
  return '';
}

const BACKGROUND = 'html,body{margin:0;background:#f0eee6}@media (prefers-color-scheme:dark){html,body{background:#1f1e1d}}';

export function page(share, { url }) {
  const { meta } = share.article;
  const title = meta.title || 'A shared article';
  const summary = summaryOf(share);
  const image = imageOf(share);
  const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(meta.lang ?? '') ? meta.lang : 'en';
  // JSON in a script element: nothing inside can close it.
  const data = JSON.stringify(share).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${escape(title)}</title>
<meta name="description" content="${escape(summary)}">
<link rel="canonical" href="${escape(meta.url)}">
<link rel="icon" href="/reader/icon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/reader/icon-512.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(summary)}">
<meta property="og:site_name" content="${escape(meta.siteName || meta.host)}">
<meta property="og:url" content="${escape(url)}">
${image ? `<meta property="og:image" content="${escape(image)}">\n` : ''}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#f0eee6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1f1e1d" media="(prefers-color-scheme: dark)">
<link rel="preload" href="/reader/fonts/Newsreader.ttf" as="fetch" crossorigin>
<link rel="preload" href="/reader/fonts/Newsreader-Italic.ttf" as="fetch" crossorigin>
<style>${BACKGROUND}</style>
<script id="spine-share" type="application/json">${data}</script>
<script src="/reader/share.js?v=${VERSION}" defer></script>
</head>
<body></body>
</html>
`;
}

// The page for a link with nothing behind it.
export function missing() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>There’s nothing at this link</title>
<link rel="icon" href="/reader/icon-32.png" sizes="32x32">
<style>${BACKGROUND}body{display:grid;min-height:100vh;place-items:center;color:#1f1e1d;font:17px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}main{max-width:28em;padding:24px}h1{font:500 28px/1.2 Charter,Georgia,serif;margin:0 0 12px}a{color:#2e637a}@media (prefers-color-scheme:dark){body{color:#efede5}a{color:#8fbfd4}}</style>
</head>
<body>
<main>
<h1>There’s nothing at this link</h1>
<p>It may have been copied wrongly, or whoever shared it has stopped sharing it.</p>
<p><a href="https://cnxluc.github.io/spine/">What is Spine?</a></p>
</main>
</body>
</html>
`;
}
