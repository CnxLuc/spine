// The article as the reader sees it, and the model of it the reading ideas use.
//
// The extracted blocks are laid out in sections (split at each h2), and every
// sentence of every paragraph, list item and quotation is wrapped once, in
// spans that carry its number. The reading ideas then only change classes on
// those spans: which sentences are key, which fold away, which run is open.
import { breakAt, fingerprint, minutes, splitSentences, squash, wordCount } from './text.js';

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const BACK_MATTER = new RegExp(
  `^(${[
    'foot ?notes?', 'end ?notes?', 'notes', 'references', 'sources', 'bibliography', 'citations', 'works cited',
    'further reading', 'see also', 'external links', 'acknowledg(e)?ments', 'notes and references',
    // French, Spanish, German, Italian
    'notes et références', 'références', 'voir aussi', 'bibliographie', 'liens externes', 'articles connexes',
    'referencias', 'véase también', 'enlaces externos', 'bibliografía', 'notas',
    'einzelnachweise', 'literatur', 'weblinks', 'siehe auch', 'anmerkungen',
    'note', 'bibliografia', 'voci correlate', 'collegamenti esterni',
  ].join('|')})$`,
  'i',
);

// Text inside these never counts as a sentence of the block it sits in.
const SKIP = 'sup.fn, ul, ol, figure, pre, table, .anchor, .pill';

// The text of a block and each text node's offset in it, skipping footnote
// markers, nested lists and anything else in SKIP between a node and the block.
export function textOf(block, skip = SKIP) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let element = node.parentElement; element && element !== block; element = element.parentElement) {
        if (element.matches(skip)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  const nodes = [];
  while (walker.nextNode()) {
    nodes.push({ node: walker.currentNode, start: text.length });
    text += walker.currentNode.data;
  }
  return { text, nodes };
}

// The bold lead-in that opens a block, like "Maximize leverage.", as the offset
// where it ends, including a period or colon right after it.
function leadEnd(block, text, nodes) {
  const first = [...block.childNodes].find(node => node.nodeType !== Node.TEXT_NODE || node.data.trim());
  if (first?.nodeName !== 'STRONG') return null;
  const inside = nodes.filter(({ node }) => first.contains(node));
  if (!inside.length) return null;
  const leadText = squash(first.textContent);
  if (leadText.length > 100 || wordCount(leadText) > 12) return null;
  let end = inside.at(-1).start + inside.at(-1).node.data.length;
  if (/[.:—–-]/.test(text[end] ?? '')) end++;
  // A lead-in needs something to lead into.
  if (wordCount(text.slice(end)) < 2) return null;
  return end;
}

// Wraps [from, to) of a text node in a new span and returns it.
function wrap(node, from, to) {
  let target = node;
  if (from > 0) target = target.splitText(from);
  if (to - from < target.data.length) target.splitText(to - from);
  const span = document.createElement('span');
  target.parentNode.insertBefore(span, target);
  span.appendChild(target);
  return span;
}

function header(meta, words) {
  const head = make('header', 'doc-head');
  const kicker = make('div', 'kicker');
  const icon = make('img', 'favicon');
  icon.alt = '';
  icon.src = meta.favicon;
  icon.referrerPolicy = 'no-referrer';
  icon.addEventListener('error', () => icon.remove(), { once: true });
  kicker.append(icon, make('span', 'kicker-site', meta.siteName));
  head.append(kicker, make('h1', 'doc-title', meta.title));
  // A description that repeats the title or the opening isn't a subtitle.
  const flat = text => squash(text).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
  const excerpt = meta.excerpt && meta.excerpt.length > 30 && meta.excerpt.length < 320 && !meta.dekInBody ? meta.excerpt : '';
  const repeatsTitle = excerpt && flat(meta.title).includes(flat(excerpt).slice(0, 30));
  const dek = meta.dek || (repeatsTitle ? '' : excerpt);
  if (dek) head.append(make('p', 'doc-dek', dek));
  const byline = make('p', 'doc-byline');
  const parts = [];
  if (meta.byline) parts.push(make('span', 'author', meta.byline));
  if (meta.published) parts.push(make('span', 'date', meta.published));
  const time = make('span', 'read-time', `${minutes(words)} min read`);
  parts.push(time);
  parts.forEach((part, index) => {
    if (index) byline.append(make('span', 'sep', '·'));
    byline.append(part);
  });
  head.append(byline);
  return head;
}

function footer(meta) {
  const foot = make('footer', 'doc-foot');
  const end = make('div', 'end-mark', '⁂');
  const source = make('p', 'source');
  source.append('From ');
  const link = make('a', null, meta.siteName || meta.host);
  link.href = meta.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  source.append(link, '.');
  const credit = make('p', 'credit');
  credit.append('Reading ideas from ');
  const series = make('a', null, 'Interfaces that think');
  series.href = 'https://tareqistyping.com/interfaces-that-think/';
  series.target = '_blank';
  series.rel = 'noopener noreferrer';
  credit.append(series, ' by Tareq Ismail.');
  foot.append(end, source, credit);
  return foot;
}

function sectionShell(index, heading) {
  const el = make('section', 'sec');
  el.dataset.sec = index;
  let headingEl = null;
  if (heading) {
    headingEl = heading;
    headingEl.classList.add('sec-title');
    headingEl.id = `spine-sec-${index}`;
    el.append(headingEl);
  }
  const fold = make('div', 'sec-fold');
  const body = make('div', 'sec-body');
  const callout = make('div', 'callout');
  callout.setAttribute('role', 'button');
  callout.tabIndex = -1;
  callout.setAttribute('aria-expanded', 'false');
  const note = make('p', 'callout-text');
  const more = make('p', 'callout-more');
  const pill = make('span', 'callout-pill');
  pill.setAttribute('aria-hidden', 'true');
  pill.append(make('span', 'dots', '…'));
  more.append(pill, make('span', 'sr-only', 'Read the full section'));
  callout.append(note, more);
  fold.append(body, callout);
  el.append(fold);
  return { index, el, headingEl, heading: heading ? squash(heading.textContent) : 'Opening', fold, body, callout, note };
}

// Lays out the extracted article and wraps its sentences. Returns the model
// every reading idea works from.
export function buildArticle({ meta, blocks, words }) {
  const root = make('article', 'doc');
  root.lang = meta.lang;
  root.dir = meta.dir === 'rtl' ? 'rtl' : 'ltr';
  // A description that just repeats the opening isn't a subtitle, even when it
  // starts with the title, as Medium's do.
  const opening = squash(blocks.find(block => block.nodeName === 'P')?.textContent ?? '');
  if (meta.excerpt && squash(meta.excerpt).toLowerCase().startsWith(squash(meta.title).toLowerCase())) {
    meta.excerpt = squash(meta.excerpt).slice(squash(meta.title).length).trim();
  }
  meta.dekInBody = Boolean(meta.excerpt) && opening.startsWith(squash(meta.excerpt).replace(/[.…]+$/, '').slice(0, 50));
  const body = make('div', 'doc-body');
  const sections = [];
  let current = null;
  for (const block of blocks) {
    if (block.nodeName === 'H2') {
      current = sectionShell(sections.length, block);
      sections.push(current);
      continue;
    }
    if (!current) {
      current = sectionShell(0, null);
      sections.push(current);
    }
    current.body.append(block);
  }
  for (const section of sections) body.append(section.el);
  root.append(header(meta, words), body, footer(meta));

  // Notes and references close the piece but aren't part of its argument: they
  // read smaller and the reading ideas leave them alone.
  for (const section of sections) {
    section.back = BACK_MATTER.test(section.heading);
    section.el.classList.toggle('back-matter', section.back);
  }

  // Sentences, numbered from s1 in reading order.
  const sentences = [];
  const textBlocks = [];
  let n = 0;
  for (const section of sections) {
    section.blocks = [];
    section.sentences = [];
    if (section.back) {
      section.words = 0;
      continue;
    }
    for (const element of section.body.querySelectorAll('p, li')) {
      if (element.closest('figure, table, figcaption')) continue;
      const { text, nodes } = textOf(element);
      if (!squash(text)) continue;
      const parts = splitSentences(text, meta.lang);
      const end = leadEnd(element, text, nodes);
      const leads = end ? breakAt(parts, text, end) : 0;
      element.classList.add('tb');
      const block = {
        el: element,
        kind: element.nodeName === 'LI' ? 'li' : element.closest('blockquote') ? 'quote' : 'p',
        sec: section.index,
        sentences: [],
      };
      for (const [index, part] of parts.entries()) {
        const sentence = {
          n: ++n,
          id: `s${n}`,
          text: part.text,
          words: wordCount(part.text),
          lead: index < leads,
          block,
          sec: section.index,
          range: part,
          frags: [],
          refs: [],
        };
        block.sentences.push(sentence);
        section.sentences.push(sentence);
        sentences.push(sentence);
      }
      // Wrap from the end backward, so earlier offsets stay valid.
      const fragments = [];
      for (const sentence of block.sentences) {
        for (const { node, start } of nodes) {
          const from = Math.max(sentence.range.start - start, 0);
          const to = Math.min(sentence.range.end - start, node.data.length);
          if (from < to) fragments.push({ node, from, to, at: start + from, sentence });
        }
      }
      fragments.sort((a, b) => b.at - a.at);
      for (const { node, from, to, sentence } of fragments) {
        if (!node.data.slice(from, to).trim()) continue;
        const span = wrap(node, from, to);
        span.className = sentence.lead ? 's lead' : 's';
        span.dataset.s = sentence.n;
        sentence.frags.unshift(span);
      }
      // A footnote marker belongs to the sentence it follows.
      for (const ref of element.querySelectorAll('sup.fn')) {
        if (ref.parentElement.closest('li') !== element.closest('li') && element.nodeName === 'LI') continue;
        const spans = [...element.querySelectorAll('.s')];
        const before = spans.filter(span => span.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
        const owner = before ?? spans[0];
        const sentence = owner && block.sentences.find(s => String(s.n) === owner.dataset.s);
        if (sentence) {
          ref.dataset.s = sentence.n;
          sentence.refs.push(ref);
        }
      }
      if (block.sentences.length) {
        textBlocks.push(block);
        section.blocks.push(block);
      }
    }
    section.words = section.sentences.reduce((sum, s) => sum + s.words, 0);
  }

  // Lists of three or more items, which the list ideas can show another way.
  const lists = [];
  for (const section of sections) {
    if (section.back) continue;
    for (const list of section.body.querySelectorAll(':scope > ul, :scope > ol, :scope > blockquote > ul, :scope > blockquote > ol')) {
      const items = [...list.children].filter(child => child.nodeName === 'LI');
      if (items.length < 3) continue;
      const before = list.previousElementSibling;
      lists.push({
        index: lists.length,
        el: list,
        items,
        sec: section.index,
        heading: section.heading,
        intro: before?.nodeName === 'P' ? squash(before.textContent).slice(-400) : '',
        texts: items.map(item => squash(textOf(item, 'sup.fn, .anchor, .pill').text)),
      });
      list.dataset.list = lists.length - 1;
    }
  }

  const byId = new Map(sentences.map(sentence => [sentence.id, sentence]));
  const total = sentences.reduce((sum, s) => sum + s.words, 0);
  // The reading time counts the piece itself, not its notes.
  if (total) root.querySelector('.read-time').textContent = `${minutes(total)} min read`;
  return {
    meta,
    root,
    body,
    sections,
    blocks: textBlocks,
    sentences,
    byId,
    lists,
    words: total || words,
    fingerprint: fingerprint(JSON.stringify(sections.map(section => section.sentences.map(s => s.text)))),
  };
}

// What the model reads: the article's sections, with every block and sentence,
// and what sits between them (figures, code, tables, subheadings) as context.
export function describe(article) {
  return {
    title: article.meta.title,
    byline: article.meta.byline,
    site: article.meta.siteName,
    lang: article.meta.lang,
    words: article.words,
    sections: article.sections.filter(section => !section.back).map(section => {
      const items = [];
      for (const element of section.body.querySelectorAll('.tb, figure, pre, .table-wrap, h3, h4')) {
        if (element.classList.contains('tb')) {
          const block = article.blocks.find(b => b.el === element);
          if (!block) continue;
          items.push({
            kind: block.kind,
            sentences: block.sentences.map(s => ({ id: s.id, text: s.text, lead: s.lead })),
          });
        } else if (element.nodeName === 'FIGURE') {
          if (element.closest('.tb')) continue;
          items.push({ kind: 'figure', text: squash(element.querySelector('figcaption')?.textContent ?? '').slice(0, 200) });
        } else if (element.nodeName === 'PRE') {
          items.push({ kind: 'code', text: squash(element.textContent).slice(0, 120) });
        } else if (element.classList.contains('table-wrap')) {
          items.push({ kind: 'table', text: squash(element.querySelector('caption')?.textContent ?? '').slice(0, 120) });
        } else {
          items.push({ kind: 'subheading', text: squash(element.textContent) });
        }
      }
      return { heading: section.heading, hasHeading: Boolean(section.headingEl), words: section.words, items };
    }),
    lists: article.lists.map(list => ({
      index: list.index,
      heading: list.heading,
      intro: list.intro,
      items: list.texts,
    })),
  };
}
