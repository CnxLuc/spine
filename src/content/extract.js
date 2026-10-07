// Finding the article on a page and rebuilding it as clean, plain blocks.
//
// Mozilla's Readability finds the article. Its HTML is then rebuilt element by
// element from an allowlist, in this document, so nothing from the page runs
// and every article arrives in the same shape: headings, paragraphs, lists,
// quotations, figures with captions, code, tables and dividers. Images keep
// their sources, sizes and captions.
import { Readability } from '@mozilla/readability';
import { squash, wordCount } from './text.js';

const HOST_ID = 'spine-reader-host';

const DROP = new Set(
  'script style noscript template svg math canvas form input button select textarea label nav aside footer header iframe object embed audio map area link meta base dialog menu source track'.split(
    ' ',
  ),
);
const INLINE = new Set(
  'a abbr b bdi bdo cite code data del dfn em font i img ins kbd mark q s samp small span strike strong sub sup time tt u var wbr br'.split(
    ' ',
  ),
);
const BLOCKISH = 'p,div,section,article,main,ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote,pre,figure,table,hr,dl,picture,video,header,footer,details';
const TOOLTIP = 'div, p, aside, [class*="tooltip"], [class*="popover"], [class*="footnote-content"], [class*="footnote-text"]';
const READ_TIME = /^\d+\s*(min|minute)s?\s*(read|reading)?$/i;
const JUNK = /^(advertisement|sponsored|share( this( article| story| post)?)?|subscribe( now)?|sign up( now)?|read more|related( articles| stories)?|continue reading|follow us|click to share|loading\.*)$/i;

const make = (tag, attrs = {}) => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== false) element.setAttribute(name, value);
  }
  return element;
};

function absolute(url, base) {
  if (!url) return null;
  try {
    return new URL(url.trim(), base).href;
  } catch {
    return null;
  }
}

// A link the reader can follow: web and mail links, or an anchor in the article.
function safeHref(raw, base, pageUrl) {
  if (!raw || /^\s*javascript:/i.test(raw)) return null;
  const href = absolute(raw, base);
  if (!href) return null;
  const url = new URL(href);
  const page = new URL(pageUrl);
  if (url.hash && url.origin + url.pathname === page.origin + page.pathname && url.search === page.search) {
    return { anchor: decodeURIComponent(url.hash.slice(1)) };
  }
  if (!/^(https?|mailto):$/.test(url.protocol)) return null;
  return { href };
}

function safeSrc(raw, base) {
  if (!raw) return null;
  if (/^\s*data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(raw)) {
    // Lazy-loading placeholders are tiny data images; real ones are long.
    return raw.length > 400 ? raw.trim() : null;
  }
  const src = absolute(raw, base);
  return src && /^https?:/i.test(src) ? src : null;
}

function safeSrcset(raw, base) {
  if (!raw) return null;
  const parts = raw
    .split(/,\s+(?=\S)/)
    .map(part => {
      const [url, descriptor] = part.trim().split(/\s+/, 2);
      const src = safeSrc(url, base);
      return src && !src.startsWith('data:') ? `${src}${descriptor ? ` ${descriptor}` : ''}` : null;
    })
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// The largest candidate in a srcset, for the lightbox.
function largest(srcset) {
  let best = null;
  let size = 0;
  for (const part of (srcset ?? '').split(/,\s+(?=\S)/)) {
    const [url, descriptor = '1x'] = part.trim().split(/\s+/, 2);
    const value = parseFloat(descriptor) * (descriptor.endsWith('x') ? 1000 : 1);
    if (url && value > size) {
      size = value;
      best = url;
    }
  }
  return best;
}

const number = value => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Lazy-loaded images keep their real address in data attributes; move it into
// place before Readability reads the page, so it keeps them.
function wakeImages(root) {
  for (const img of root.querySelectorAll('img')) {
    const lazy =
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-url') ||
      img.getAttribute('data-hi-res-src');
    const src = img.getAttribute('src') || '';
    if (lazy && (!src || src.startsWith('data:') || /placeholder|blank|spacer|lazy/i.test(src))) {
      img.setAttribute('src', lazy);
    }
    const lazySet = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
    if (lazySet && !img.getAttribute('srcset')) img.setAttribute('srcset', lazySet);
    img.removeAttribute('loading');
  }
  // <picture> often keeps the best sources in <source> elements.
  for (const picture of root.querySelectorAll('picture')) {
    const img = picture.querySelector('img');
    if (!img) continue;
    const sources = [...picture.querySelectorAll('source')];
    const set =
      sources.find(source => !source.type || /webp|jpe?g|png|avif/.test(source.type))?.getAttribute('srcset') ||
      sources[0]?.getAttribute('data-srcset');
    if (set && !img.getAttribute('srcset')) img.setAttribute('srcset', set);
    if (!img.getAttribute('src') && set) img.setAttribute('src', set.split(/\s+/)[0]);
  }
}

// Headings often sit in a wrapper with an edit link or a permalink (Wikipedia,
// GitHub). Readability can mistake the wrapper for clutter and drop the
// heading with it, so the heading takes the wrapper's place.
function freeHeadings(root) {
  for (const junk of root.querySelectorAll('.mw-editsection, .mw-jump-link, a.anchor[aria-label^="Permalink"], .heading-anchor, .header-anchor')) {
    junk.remove();
  }
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const parent = heading.parentElement;
    if (!parent || parent === root.body || !/^(DIV|SPAN)$/.test(parent.nodeName)) continue;
    const extra = [...parent.childNodes].filter(node => node !== heading).map(node => node.textContent).join(' ');
    if (wordCount(extra) <= 2 && parent.querySelectorAll('h1, h2, h3, h4, h5, h6').length === 1) parent.replaceWith(heading);
  }
}

// Some pages build lines of text from divs they show inline, like the links in
// an X article. Readability takes a div for a block, and drops a block holding
// only a link as clutter, so a div the page shows inline becomes a span in the
// copy Spine reads.
function inlineDivs(live, copy) {
  const shown = live.getElementsByTagName('div');
  const copies = copy.getElementsByTagName('div');
  if (shown.length !== copies.length) return;
  const inline = [...shown].flatMap((div, index) => (getComputedStyle(div).display === 'inline' ? [copies[index]] : []));
  for (const div of inline) {
    const span = div.ownerDocument.createElement('span');
    span.append(...div.childNodes);
    div.replaceWith(span);
  }
}

function copyOf(element, into) {
  const copy = into.importNode(element, true);
  inlineDivs(element, copy);
  return copy;
}

// Where some sites keep the article, for when Readability picks the wrong part
// of the page: forums built on ForumMagnum (LessWrong and its siblings) put
// long comment threads next to the post. X shows an article inside the post's
// conversation, with its cover, title and author outside the text; the text
// comes clean, and Readability would drop its headings, whose class names say
// "header", so Spine reads it as it is.
const SITE_RULES = [
  { hosts: /(^|\.)(lesswrong\.com|alignmentforum\.org|forum\.effectivealtruism\.org|progressforum\.org)$/, selector: '#postContent, .PostsPage-postContent' },
  {
    hosts: /(^|\.)(x|twitter)\.com$/,
    selector: '[data-testid="twitterArticleRichTextView"]',
    cover: '[data-testid="twitterArticleReadView"] [data-testid="tweetPhoto"]',
    title: '[data-testid="twitter-article-title"]',
    byline: '[data-testid="User-Name"] a',
    asIs: true,
  },
];
// Containers many sites put their article in, most specific first.
const CONTAINERS = [
  '[itemprop="articleBody"]',
  '[data-testid="article-body"]',
  '[class*="ArticleBody"]',
  '[class*="article-body"]',
  '[class*="articleBody"]',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.post-body',
  '.story-body',
  '.markdown-body',
  'article',
  'main',
];

// Words in an element's paragraphs and list items: the article, roughly,
// without its navigation.
function paragraphWords(root) {
  if (!root) return 0;
  return [...root.querySelectorAll('p, li')].reduce((sum, element) => sum + wordCount(element.textContent), 0);
}

// The container with the most paragraph text, if it holds a real article.
function bestContainer(doc) {
  let best = null;
  let most = 0;
  for (const selector of CONTAINERS) {
    for (const element of doc.querySelectorAll(selector)) {
      const words = paragraphWords(element);
      if (words > most * 1.15) {
        best = element;
        most = words;
      }
    }
  }
  return most >= 150 ? best : null;
}

// Readability on just one part of the page, with the page's head for its title
// and metadata.
function readPart(doc, element) {
  const part = document.implementation.createHTMLDocument(doc.title);
  part.head.replaceWith(part.importNode(doc.head, true));
  const article = part.createElement('article');
  article.append(copyOf(element, part));
  part.body.append(article);
  wakeImages(part);
  freeHeadings(part);
  try {
    const parsed = new Readability(part, { charThreshold: 200, keepClasses: true, serializer: node => node }).parse();
    if (parsed?.content && paragraphWords(parsed.content) >= paragraphWords(element) * 0.6) return parsed;
  } catch {}
  // Readability cleaned away too much: keep the part as the page has it.
  const raw = copyOf(element, part);
  return { content: raw, title: doc.title };
}

// Everything the header shows, read from the live page.
function readMeta(doc, parsed) {
  const meta = name =>
    doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content')?.trim() || '';
  const base = doc.baseURI;
  const canonical = absolute(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), base);
  const url = canonical && /^https?:/.test(canonical) ? canonical : location.href;
  const icons = [...doc.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
    .map(link => ({
      href: absolute(link.getAttribute('href'), base),
      size: parseInt(link.getAttribute('sizes'), 10) || (link.rel.includes('apple') ? 180 : 16),
    }))
    .filter(icon => icon.href)
    .sort((a, b) => Math.abs(a.size - 64) - Math.abs(b.size - 64));
  const lang = (parsed?.lang || doc.documentElement.lang || meta('og:locale') || 'en').replace('_', '-');
  const published =
    parsed?.publishedTime ||
    meta('article:published_time') ||
    meta('datePublished') ||
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ||
    '';
  let byline = squash(parsed?.byline || meta('author') || '');
  byline = byline.replace(/^by\s+/i, '');
  if (byline.length > 80 || /^https?:/.test(byline) || /\[bot\]|^@?[\w-]+bot$/i.test(byline)) byline = '';
  const host = location.hostname.replace(/^www\./, '');
  // A publisher's legal name ("Wikimedia Foundation, Inc.") isn't what readers call the site.
  let siteName = squash(parsed?.siteName || meta('og:site_name') || '');
  if (/\b(inc|llc|ltd|gmbh|corp|corporation|foundation|limited)\b\.?/i.test(siteName)) {
    const ogName = squash(meta('og:site_name'));
    const label = host.split('.').slice(-2, -1)[0] ?? host;
    siteName = ogName && !/\b(inc|llc|ltd)\b/i.test(ogName) ? ogName : label.charAt(0).toUpperCase() + label.slice(1);
  }
  return {
    url,
    host,
    title: squash(parsed?.title || meta('og:title') || doc.title || host),
    byline,
    siteName: siteName || host,
    excerpt: squash(parsed?.excerpt || meta('description') || ''),
    published: formatDate(published, lang),
    lang,
    dir: parsed?.dir || doc.documentElement.dir || doc.body?.dir || 'ltr',
    favicon: icons[0]?.href || `${location.origin}/favicon.ico`,
    image: absolute(meta('og:image'), base),
  };
}

function formatDate(value, lang) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1990) return '';
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  } catch {
    return date.toDateString();
  }
}

// Rebuilds Readability's HTML into blocks, from an allowlist.
class Rebuilder {
  constructor(base, pageUrl) {
    this.base = base;
    this.pageUrl = pageUrl;
  }

  // Copies an element's id onto what stands for it, so footnote links work.
  anchor(source, target) {
    const id = source.getAttribute?.('id') || (source.localName === 'a' && source.getAttribute('name'));
    if (id && !target.dataset.anchor) target.dataset.anchor = id;
  }

  inline(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.data);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = node.localName;
    if (DROP.has(tag)) return null;
    if (tag === 'br') return make('br');
    if (tag === 'wbr') return null;
    if (tag === 'img') return this.smallImage(node);
    const children = () => {
      const fragment = document.createDocumentFragment();
      for (const child of node.childNodes) {
        const converted = this.inline(child);
        if (converted) fragment.append(converted);
      }
      return fragment;
    };
    const wrap = name => {
      const element = make(name);
      element.append(children());
      this.anchor(node, element);
      return element.childNodes.length ? element : null;
    };
    switch (tag) {
      case 'a': {
        const link = safeHref(node.getAttribute('href'), this.base, this.pageUrl);
        const content = children();
        if (!link) {
          const id = node.getAttribute('id') || node.getAttribute('name');
          if (id && !content.childNodes.length) {
            const marker = make('span', { class: 'anchor' });
            marker.dataset.anchor = id;
            return marker;
          }
          return content;
        }
        const a = link.anchor
          ? make('a', { href: `#${link.anchor}`, class: 'jump' })
          : make('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer' });
        if (link.anchor) a.dataset.jump = link.anchor;
        a.append(content);
        this.anchor(node, a);
        return a.childNodes.length ? a : null;
      }
      case 'em':
      case 'i':
      case 'cite':
      case 'dfn':
      case 'var':
        return wrap('em');
      case 'strong':
      case 'b':
        return wrap('strong');
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
        return wrap('code');
      case 'del':
      case 'strike':
      case 's':
        return wrap('s');
      case 'sup': {
        // A footnote marker may carry its note in a tooltip; the note itself
        // usually sits in the article's notes, so keep only the marker.
        for (const tip of node.querySelectorAll(TOOLTIP)) tip.remove();
        const sup = wrap('sup');
        // A footnote marker: a link, or a bare number. Its text isn't part of a sentence.
        if (sup && (sup.querySelector('a') || /^\[?\d{1,3}\]?$/.test(sup.textContent.trim()))) {
          sup.className = 'fn';
        }
        return sup;
      }
      case 'sub':
      case 'mark':
      case 'small':
      case 'q':
      case 'abbr':
        return wrap(tag);
      default: {
        const content = children();
        const id = node.getAttribute('id');
        if (id) {
          const marker = make('span', { class: 'anchor' });
          marker.dataset.anchor = id;
          content.prepend(marker);
        }
        return content;
      }
    }
  }

  // An image small enough to sit in a line of text, like an emoji or an icon.
  smallImage(img) {
    const width = number(img.getAttribute('width'));
    const height = number(img.getAttribute('height'));
    const emoji = /emoji|icon/i.test(`${img.className} ${img.getAttribute('src')}`);
    if (!emoji && !(width && height && width <= 48 && height <= 48)) return null;
    const src = safeSrc(img.getAttribute('src'), this.base);
    if (!src) return null;
    return make('img', { src, alt: img.getAttribute('alt') || '', class: 'inline-img', loading: 'lazy' });
  }

  isLargeImage(img) {
    const width = number(img.getAttribute('width'));
    const height = number(img.getAttribute('height'));
    if (width && height && (width <= 2 || height <= 2)) return false;
    if (width && height && width <= 48 && height <= 48) return false;
    if (/emoji|icon|avatar|gravatar|badge/i.test(`${img.className} ${img.getAttribute('src')}`)) {
      return Boolean(width && width > 160);
    }
    return Boolean(img.getAttribute('src') || img.getAttribute('srcset'));
  }

  // A figure for one image, with the link around it as its full-size version.
  figureFor(img, caption = null) {
    const src = safeSrc(img.getAttribute('src'), this.base);
    const srcset = safeSrcset(img.getAttribute('srcset'), this.base);
    const best = src && !src.startsWith('data:') ? src : largest(srcset);
    if (!best) return null;
    const width = number(img.getAttribute('width'));
    const height = number(img.getAttribute('height'));
    const figure = make('figure', { class: 'fig' });
    const image = make('img', {
      src: best,
      srcset,
      sizes: srcset ? '(min-width: 900px) 880px, 100vw' : null,
      alt: squash(img.getAttribute('alt') || ''),
      width,
      height,
      loading: 'lazy',
      decoding: 'async',
    });
    // The link around a picture is its full-size version only when it points
    // at an image file, not at a page about it (like Wikipedia's File: pages).
    const linked = absolute(img.closest('a')?.getAttribute('href'), this.base);
    const path = linked ? new URL(linked).pathname : '';
    const full = /\.(jpe?g|png|gif|webp|avif)$/i.test(path) && !/[:]|\/wiki\//i.test(decodeURIComponent(path)) ? linked : null;
    image.dataset.full = full || largest(srcset) || best;
    figure.append(image);
    if (caption && squash(caption.textContent)) {
      const figcaption = make('figcaption');
      figcaption.append(caption);
      figure.append(figcaption);
    }
    return figure;
  }

  videoFigure(video) {
    const src =
      safeSrc(video.getAttribute('src'), this.base) ||
      [...video.querySelectorAll('source')].map(s => safeSrc(s.getAttribute('src'), this.base)).find(Boolean);
    if (!src) return null;
    const figure = make('figure', { class: 'fig' });
    figure.append(
      make('video', {
        src,
        poster: safeSrc(video.getAttribute('poster'), this.base),
        controls: '',
        preload: 'metadata',
        playsinline: '',
        width: number(video.getAttribute('width')),
        height: number(video.getAttribute('height')),
      }),
    );
    return figure;
  }

  embedFigure(frame) {
    const src = absolute(frame.getAttribute('src') || frame.getAttribute('data-src'), this.base);
    if (!src || !/^https?:/.test(src)) return null;
    const url = new URL(src);
    const youtube = src.match(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]{6,})/);
    const figure = make('figure', { class: 'fig embed' });
    const link = make('a', { target: '_blank', rel: 'noopener noreferrer', class: 'embed-link' });
    if (youtube) {
      link.href = `https://www.youtube.com/watch?v=${youtube[1]}`;
      link.append(
        make('img', {
          src: `https://i.ytimg.com/vi/${youtube[1]}/hqdefault.jpg`,
          alt: '',
          loading: 'lazy',
          width: 480,
          height: 360,
        }),
      );
      const label = make('span', { class: 'embed-label' });
      label.textContent = 'Watch on YouTube';
      link.append(label);
    } else {
      link.href = src;
      const label = make('span', { class: 'embed-label' });
      label.textContent = `Open embedded content from ${url.hostname.replace(/^www\./, '')}`;
      link.append(label);
    }
    figure.append(link);
    return figure;
  }

  // A paragraph, split around any large images inside it.
  paragraph(p) {
    const out = [];
    let current = make('p');
    this.anchor(p, current);
    const push = () => {
      if (hasContent(current)) out.push(current);
      current = make('p');
    };
    const visit = node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.localName;
        if ((tag === 'img' && this.isLargeImage(node)) || tag === 'picture') {
          const img = tag === 'img' ? node : node.querySelector('img');
          const figure = img && this.figureFor(img);
          if (figure) {
            push();
            out.push(figure);
          }
          return;
        }
        if (tag === 'video') {
          const figure = this.videoFigure(node);
          if (figure) {
            push();
            out.push(figure);
          }
          return;
        }
        // A link or span around a large image: look inside it.
        if ((tag === 'a' || tag === 'span') && node.querySelector('img, picture') && !squash(node.textContent)) {
          for (const child of node.childNodes) visit(child);
          return;
        }
        if (!INLINE.has(tag) && node.matches(BLOCKISH)) {
          push();
          out.push(...this.convert(node));
          return;
        }
      }
      const converted = this.inline(node);
      if (converted) current.append(converted);
    };
    for (const child of p.childNodes) visit(child);
    push();
    return out.map(block => (block.localName === 'p' ? this.promote(block) : block));
  }

  // A short paragraph that's only bold text, with no closing punctuation, is a heading.
  promote(p) {
    const only = [...p.childNodes].filter(node => node.nodeType !== Node.TEXT_NODE || node.data.trim());
    if (only.length !== 1 || only[0].localName !== 'strong') return p;
    const text = squash(p.textContent);
    if (wordCount(text) > 14 || /[.:!?,;]$/.test(text)) return p;
    const heading = make('h4');
    heading.textContent = text;
    heading.dataset.promoted = '';
    return heading;
  }

  heading(node) {
    const level = Number(node.localName.slice(1));
    const heading = make(`h${level}`);
    for (const child of node.childNodes) {
      const converted = this.inline(child);
      if (converted) heading.append(converted);
    }
    this.anchor(node, heading);
    // Links in headings are usually self-links; keep the words only.
    for (const a of heading.querySelectorAll('a')) a.replaceWith(...a.childNodes);
    return squash(heading.textContent) ? [heading] : [];
  }

  list(node) {
    const list = make(node.localName === 'ol' ? 'ol' : 'ul');
    const start = number(node.getAttribute('start'));
    if (list.localName === 'ol' && start && start !== 1) list.setAttribute('start', start);
    this.anchor(node, list);
    for (const child of node.children) {
      if (child.localName === 'li') {
        const item = this.listItem(child);
        if (item) list.append(item);
      } else if (child.localName === 'ul' || child.localName === 'ol') {
        const nested = this.list(child);
        if (nested.children.length) list.lastElementChild?.append(nested);
      }
    }
    return list;
  }

  listItem(li) {
    const item = make('li');
    this.anchor(li, item);
    let paragraphs = 0;
    const visit = node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.localName;
        if (tag === 'ul' || tag === 'ol') {
          const nested = this.list(node);
          if (nested.children.length) item.append(nested);
          return;
        }
        if (tag === 'img' && this.isLargeImage(node)) {
          const figure = this.figureFor(node);
          if (figure) item.append(figure);
          return;
        }
        if (!INLINE.has(tag) && node.matches(BLOCKISH)) {
          for (const block of this.convert(node)) {
            if (block.localName === 'p') {
              if (paragraphs++ && squash(item.textContent)) item.append(make('br'), make('br'));
              item.append(...block.childNodes);
            } else item.append(block);
          }
          return;
        }
      }
      const converted = this.inline(node);
      if (converted) item.append(converted);
    };
    for (const child of li.childNodes) visit(child);
    return hasContent(item) ? item : null;
  }

  quote(node) {
    const blocks = this.blocks(node).filter(block => !/^H\d$/.test(block.nodeName));
    if (!blocks.length) return [];
    const quote = make('blockquote');
    this.anchor(node, quote);
    quote.append(...blocks);
    return [quote];
  }

  code(node) {
    let text = '';
    const walk = current => {
      for (const child of current.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.data;
        else if (child.localName === 'br') text += '\n';
        else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
          if (/^(div|p|tr)$/.test(child.localName) && !text.endsWith('\n')) text += '\n';
        }
      }
    };
    walk(node);
    text = text.replace(/^\n+|\s+$/g, '');
    if (!text) return [];
    const pre = make('pre');
    const code = make('code');
    code.textContent = text;
    pre.append(code);
    return [pre];
  }

  figure(node) {
    const media = [...node.querySelectorAll('img, video, iframe')].filter(
      element => element.localName !== 'img' || this.isLargeImage(element),
    );
    const captionSource = node.querySelector('figcaption');
    const caption = captionSource ? this.inlineOf(captionSource) : null;
    if (!media.length) {
      // A figure of text, like a pull quote: keep its words.
      return this.blocks(node);
    }
    const figures = media
      .map((element, index) => {
        const isLast = index === media.length - 1;
        if (element.localName === 'video') return this.videoFigure(element);
        if (element.localName === 'iframe') return this.embedFigure(element);
        return this.figureFor(element, isLast ? caption : null);
      })
      .filter(Boolean);
    if (figures.length > 1) {
      // A gallery: images side by side, one caption under them.
      const gallery = make('figure', { class: 'fig gallery' });
      for (const figure of figures) {
        const img = figure.querySelector('img, video, a');
        if (img) gallery.append(img);
      }
      const last = figures.at(-1).querySelector('figcaption');
      if (last) gallery.append(last);
      return [gallery];
    }
    return figures;
  }

  inlineOf(node) {
    const fragment = document.createDocumentFragment();
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && !INLINE.has(child.localName)) {
        if (DROP.has(child.localName)) continue;
        if (fragment.childNodes.length) fragment.append(' ');
        fragment.append(this.inlineOf(child));
        continue;
      }
      const converted = this.inline(child);
      if (converted) fragment.append(converted);
    }
    return fragment;
  }

  table(node) {
    const rows = [...node.querySelectorAll(':scope > tr, :scope > * > tr')];
    const cells = rows.flatMap(row => [...row.children]);
    // A table used for layout: one cell, or cells full of paragraphs.
    const layout =
      rows.length <= 1 ||
      cells.length <= 1 ||
      cells.some(cell => cell.querySelector('p, div, table, ul, ol, h1, h2, h3'));
    if (layout) return cells.flatMap(cell => this.blocks(cell));
    const table = make('table');
    const caption = node.querySelector('caption');
    if (caption) {
      const element = make('caption');
      element.append(this.inlineOf(caption));
      table.append(element);
    }
    const body = make('tbody');
    for (const row of rows) {
      const tr = make('tr');
      for (const cell of row.children) {
        if (cell.localName !== 'td' && cell.localName !== 'th') continue;
        const element = make(cell.localName, {
          colspan: number(cell.getAttribute('colspan')),
          rowspan: number(cell.getAttribute('rowspan')),
        });
        element.append(this.inlineOf(cell));
        tr.append(element);
      }
      if (tr.children.length) body.append(tr);
    }
    table.append(body);
    const wrap = make('div', { class: 'table-wrap' });
    wrap.append(table);
    return [wrap];
  }

  definitions(node) {
    const out = [];
    for (const child of node.children) {
      const p = make('p', { class: child.localName === 'dd' ? 'dd' : null });
      if (child.localName === 'dt') {
        const strong = make('strong');
        strong.append(this.inlineOf(child));
        p.append(strong);
      } else p.append(this.inlineOf(child));
      if (hasContent(p)) out.push(p);
    }
    return out;
  }

  // One block-level element as blocks.
  convert(node) {
    const out = [];
    const tag = node.localName;
    switch (tag) {
      case 'p':
        out.push(...this.paragraph(node));
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        out.push(...this.heading(node));
        break;
      case 'ul':
      case 'ol': {
        const list = this.list(node);
        if (list.children.length) out.push(list);
        break;
      }
      case 'blockquote':
        out.push(...this.quote(node));
        break;
      case 'pre':
        out.push(...this.code(node));
        break;
      case 'figure':
        out.push(...this.figure(node));
        break;
      case 'img': {
        const figure = this.figureFor(node);
        if (figure) out.push(figure);
        break;
      }
      case 'picture': {
        const img = node.querySelector('img');
        const figure = img && this.figureFor(img);
        if (figure) out.push(figure);
        break;
      }
      case 'video': {
        const figure = this.videoFigure(node);
        if (figure) out.push(figure);
        break;
      }
      case 'iframe': {
        const figure = this.embedFigure(node);
        if (figure) out.push(figure);
        break;
      }
      case 'table':
        out.push(...this.table(node));
        break;
      case 'hr':
        out.push(make('hr'));
        break;
      case 'dl':
        out.push(...this.definitions(node));
        break;
      default:
        out.push(...this.blocks(node));
    }
    return out;
  }

  // The blocks inside a container, with loose text and inline elements gathered
  // into paragraphs.
  blocks(container) {
    const out = [];
    let loose = null;
    let breaks = 0;
    const flush = () => {
      if (loose && hasContent(loose)) out.push(this.promote(loose));
      loose = null;
      breaks = 0;
    };
    for (const node of container.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.data.trim()) {
          if (loose) loose.append(' ');
          continue;
        }
        (loose ??= make('p')).append(node.data);
        breaks = 0;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.localName;
      if (DROP.has(tag) && tag !== 'iframe') continue;
      if (tag === 'br') {
        // Two line breaks in a row end a paragraph, as on older sites.
        if (++breaks >= 2) flush();
        else if (loose) loose.append(make('br'));
        continue;
      }
      if (INLINE.has(tag) && !(tag === 'img' && this.isLargeImage(node)) && !node.querySelector(BLOCKISH)) {
        const converted = this.inline(node);
        if (converted) (loose ??= make('p')).append(converted);
        breaks = 0;
        continue;
      }
      flush();
      out.push(...this.convert(node));
    }
    flush();
    return out;
  }
}

function hasContent(element) {
  return Boolean(squash(element.textContent)) || Boolean(element.querySelector?.('img, video'));
}

// The article on this page, as { meta, blocks }, or null when there isn't one.
export function extractArticle(doc = document, { force = false } = {}) {
  const clone = doc.cloneNode(true);
  inlineDivs(doc, clone);
  clone.getElementById(HOST_ID)?.remove();
  wakeImages(clone);
  freeHeadings(clone);
  let parsed = null;
  try {
    // The content comes back as an element, not HTML: parsing HTML again would
    // break nesting browsers allow in a live page, like a note inside a paragraph.
    parsed = new Readability(clone, { charThreshold: 400, keepClasses: true, serializer: element => element }).parse();
  } catch (error) {
    console.warn('Spine: Readability failed', error);
  }
  // A site whose article Spine knows where to find, or a page where
  // Readability found little: read the article's own container instead.
  const rule = SITE_RULES.find(entry => entry.hosts.test(location.hostname));
  const ruled = rule && doc.querySelector(rule.selector);
  if (ruled && wordCount(ruled.textContent) >= 150) {
    const part = rule.asIs ? { content: copyOf(ruled, document) } : readPart(doc, ruled);
    const cover = rule.cover && doc.querySelector(rule.cover);
    if (cover && !ruled.contains(cover)) part.content.prepend(copyOf(cover, document));
    const text = selector => selector && squash(doc.querySelector(selector)?.textContent ?? '');
    parsed = {
      ...parsed,
      ...part,
      title: text(rule.title) || part.title || parsed?.title,
      byline: text(rule.byline) || parsed?.byline,
      publishedTime: parsed?.publishedTime,
      siteName: parsed?.siteName,
    };
  } else if (!parsed?.content || paragraphWords(parsed.content) < 150) {
    const container = bestContainer(doc);
    if (container) parsed = { ...parsed, ...readPart(doc, container) };
  }
  let root = null;
  if (parsed?.content) {
    root = parsed.content;
  } else if (force) {
    const fallback = doc.cloneNode(true);
    fallback.getElementById(HOST_ID)?.remove();
    wakeImages(fallback);
    root = fallback.querySelector('main, article, [role="main"]') || fallback.body;
  }
  if (!root) return null;

  const meta = readMeta(doc, parsed);
  cleanTitle(meta, doc);
  const rebuilder = new Rebuilder(doc.baseURI, location.href);
  let blocks = rebuilder.blocks(root);
  blocks = tidy(blocks, meta);
  blocks = lift(blocks, meta);
  const words = blocks.reduce(
    (sum, block) => sum + (/^(P|UL|OL|BLOCKQUOTE)$/.test(block.nodeName) ? wordCount(block.textContent) : 0),
    0,
  );
  if (!force && words < 80) return null;
  return { meta, blocks, words };
}

// Drops page debris and a repeated title, and sets heading levels so the
// article's top level is h2.
function tidy(blocks, meta) {
  let out = blocks.filter(block => {
    if (block.nodeName !== 'P') return true;
    const text = squash(block.textContent);
    // Only small pictures and no words: an avatar or an icon.
    if (!text && block.querySelector('img') && !block.querySelector('img:not(.inline-img), video')) return false;
    if (block.querySelector('img, video')) return true;
    return Boolean(text) && !(wordCount(text) <= 4 && (JUNK.test(text.replace(/[.:!…]+$/, '')) || READ_TIME.test(text)));
  });
  // Some sites set the title as an image at the top, like Paul Graham's essays.
  const slug = text => squash(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const first = out[0];
  if (first?.nodeName === 'FIGURE' && !first.querySelector('figcaption')) {
    const img = first.querySelector('img');
    const name = slug(decodeURIComponent((img?.getAttribute('src') ?? '').split('/').pop().split('.')[0]).replace(/-\d+$/, ''));
    const alt = slug(img?.alt ?? '');
    const title = slug(meta.title);
    if (title.length > 6 && (name.includes(title) || title.includes(name) && name.length > 8 || alt === title)) out.shift();
  }
  // The title often repeats as the first heading.
  const firstHeading = out.findIndex(block => /^H\d$/.test(block.nodeName));
  if (firstHeading > -1 && firstHeading < 3 && similar(out[firstHeading].textContent, meta.title)) {
    out.splice(firstHeading, 1);
  }
  // A subtitle Readability left at the top, matching the description.
  const levels = [...new Set(out.filter(b => /^H\d$/.test(b.nodeName)).map(b => Number(b.nodeName[1])))].sort();
  const map = new Map(levels.map((level, index) => [level, Math.min(2 + index, 4)]));
  out = out.map(block => {
    if (!/^H\d$/.test(block.nodeName)) return block;
    const level = map.get(Number(block.nodeName[1]));
    if (`H${level}` === block.nodeName) return block;
    const heading = make(`h${level}`);
    heading.append(...block.childNodes);
    if (block.dataset.anchor) heading.dataset.anchor = block.dataset.anchor;
    if ('promoted' in block.dataset) heading.dataset.promoted = '';
    return heading;
  });
  // Headings with nothing after them before the next heading of their level or
  // above are debris ("Related", "Comments").
  while (out.length && /^H\d$/.test(out.at(-1).nodeName)) out.pop();
  return out;
}

// Titles often carry the site or the author: "Dario Amodei — Machines of Loving
// Grace", "Post title | The Site". Keep the part that names the piece, and
// take a person's name as the byline if there isn't one.
function cleanTitle(meta, doc) {
  const flat = text => squash(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const host = flat(meta.host.split('.').slice(0, -1).join(''));
  const siteName = flat(meta.siteName);
  const matches = (value, name) => Boolean(name) && (value === name || (value.length >= 5 && name.includes(value)));
  const parts = meta.title.split(/\s+[—–|·•»:]\s+|\s+-\s+/).map(squash).filter(Boolean);
  if (parts.length > 1) {
    const kept = [];
    for (const part of parts) {
      const value = flat(part);
      const byHost = matches(value, host);
      if (byHost || matches(value, siteName) || (meta.byline && value === flat(meta.byline))) {
        // A personal site is named after its author.
        if (byHost && !meta.byline && /^\p{Lu}[\p{L}'’-]+(?: \p{Lu}\.?)?(?: \p{Lu}[\p{L}'’-]+){1,2}$/u.test(part)) {
          meta.byline = part;
        }
        continue;
      }
      kept.push(part);
    }
    if (kept.length) meta.title = kept.join(' — ');
  }
  // A heading on the page that is exactly the piece's name wins.
  for (const h1 of doc.querySelectorAll('h1')) {
    const text = squash(h1.textContent);
    if (text && text.length > 3 && flat(text) === flat(meta.title)) {
      meta.title = text;
      break;
    }
  }
}

// A subtitle and a date often sit at the top of the text as short paragraphs.
// They belong in the header.
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i;
function lift(blocks, meta) {
  let at = 0;
  while (at < Math.min(blocks.length, 4)) {
    const block = blocks[at];
    if (block.nodeName !== 'P' || block.querySelector('img')) break;
    // Short links here are navigation, like "See all posts".
    const links = [...block.querySelectorAll('a')];
    if (links.some(link => wordCount(link.textContent) > 4)) break;
    const bare = block.cloneNode(true);
    for (const link of bare.querySelectorAll('a')) link.remove();
    const text = squash(bare.textContent);
    if (!text && links.length) {
      at++;
      continue;
    }
    // A line like "9 min read · Nov 11, 2017" is the page's furniture.
    const readTime = text.match(/^\d+\s*min(ute)?s?\s*read\s*[·•|,-]?\s*(.*)$/i);
    if (readTime) {
      if (!meta.published && MONTHS.test(readTime[2]) && /\d/.test(readTime[2])) meta.published = squash(readTime[2]);
      at++;
      continue;
    }
    if (!text || wordCount(text) > 18 || /[.!?…]$/.test(text)) break;
    if (MONTHS.test(text) && /\d/.test(text) && wordCount(text) <= 5) {
      if (!meta.published) meta.published = text;
    } else if (similar(text, meta.title)) {
      // The title, again.
    } else if (!meta.dek) {
      meta.dek = text;
    } else break;
    at++;
  }
  return blocks.slice(at);
}

function similar(a, b) {
  const clean = text => squash(text).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
  const x = clean(a);
  const y = clean(b);
  return Boolean(x) && (x === y || (x.length > 12 && (y.startsWith(x) || x.startsWith(y))));
}

export { HOST_ID };
