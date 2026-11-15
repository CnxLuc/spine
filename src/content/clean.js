// A shared article's blocks, held to the shape Spine's rebuilder gives them
// (extract.js), whatever the link carries: only its elements, attributes and
// classes, and only web addresses. A shared page builds the article from
// these, as the extension builds it from the page, so the same notes fit.
const ATTRIBUTES = {
  p: ['class'],
  h1: ['data-promoted'],
  h2: ['data-promoted'],
  h3: ['data-promoted'],
  h4: ['data-promoted'],
  h5: ['data-promoted'],
  h6: ['data-promoted'],
  ul: [],
  ol: ['start'],
  li: [],
  blockquote: [],
  pre: [],
  code: [],
  hr: [],
  br: [],
  figure: ['class'],
  figcaption: [],
  img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding', 'class', 'data-full'],
  video: ['src', 'poster', 'controls', 'preload', 'playsinline', 'width', 'height'],
  div: ['class'],
  table: [],
  caption: [],
  tbody: [],
  tr: [],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  a: ['href', 'target', 'rel', 'class', 'data-jump'],
  span: ['class'],
  em: [],
  strong: [],
  s: [],
  sup: ['class'],
  sub: [],
  mark: [],
  small: [],
  q: [],
  abbr: [],
};
// Footnote targets can sit on almost anything.
const EVERYWHERE = ['data-anchor'];
const CLASSES = new Set(['anchor', 'jump', 'fn', 'inline-img', 'fig', 'embed', 'gallery', 'embed-link', 'embed-label', 'table-wrap', 'dd']);
// Gone with everything inside them; any other element gives way to its content.
const DROP = new Set(
  'script style template noscript iframe frame frameset object embed svg math link meta base form input button select textarea canvas dialog audio source track'.split(' '),
);
const WEB = /^https?:\/\//i;
const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i;

function checked(name, value) {
  switch (name) {
    case 'href':
      return value.startsWith('#') || /^(https?|mailto):/i.test(value) ? value : null;
    case 'src':
    case 'poster':
    case 'data-full':
      return WEB.test(value) || IMAGE_DATA.test(value) ? value : null;
    case 'srcset':
      return value.split(/,\s+(?=\S)/).every(part => WEB.test(part.trim())) ? value : null;
    case 'class': {
      const kept = value.split(/\s+/).filter(token => CLASSES.has(token));
      return kept.length ? kept.join(' ') : null;
    }
    case 'target':
      return value === '_blank' ? value : null;
    case 'width':
    case 'height':
    case 'start':
    case 'colspan':
    case 'rowspan':
      return /^\d{1,5}$/.test(value) ? value : null;
    default:
      return value;
  }
}

function clean(node) {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.data);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.localName;
  if (DROP.has(tag)) return null;
  const allowed = ATTRIBUTES[tag];
  const out = allowed ? document.createElement(tag) : document.createDocumentFragment();
  if (allowed) {
    for (const { name, value } of node.attributes) {
      if (!allowed.includes(name) && !EVERYWHERE.includes(name)) continue;
      const safe = checked(name, value);
      if (safe !== null) out.setAttribute(name, safe);
    }
  }
  for (const child of node.childNodes) {
    const copy = clean(child);
    if (copy) out.append(copy);
  }
  return out;
}

// One block's HTML as elements of this document: usually exactly one.
export function cleanBlock(html) {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const out = [];
  for (const node of parsed.body.childNodes) {
    const copy = clean(node);
    if (!copy) continue;
    const elements = copy.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? [...copy.children] : [copy];
    out.push(...elements.filter(element => element.nodeType === Node.ELEMENT_NODE));
  }
  return out;
}
