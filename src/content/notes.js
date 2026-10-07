// Checks Claude's notes against the article and keeps only what fits, so a slip
// in a reply loses one summary or grouping instead of breaking the page.
// Adapted from Reading Long Form's article-notes.js (MIT).
import { squash, wordCount } from './text.js';

const words = text => wordCount(text);

// Curly quotes and apostrophes, for notes on an article that uses them.
export function smarten(text) {
  return String(text)
    .replace(/(\p{L})'(\p{L})/gu, '$1’$2')
    .replace(/'(\d)/g, '’$1')
    .replace(/(^|[\s([{“—–-])'/gu, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s([{‘—–-])"/gu, '$1“')
    .replace(/"/g, '”');
}
const tidy = (text, shape) => (shape.curly ? smarten(squash(text)) : squash(text));

// shape: what the checks need to know about the article.
//   ids: Set of sentence ids; order: id -> number
//   sections: [{ index, heading, hasHeading }]
//   paragraphStarts: Set of ids that open a block in the opening section
//   lists: [{ index, items: [text] }]
export function checkNotes(raw, shape) {
  const keySentences = [...new Set((raw?.keySentences ?? []).filter(id => shape.ids.has(id)))].sort(
    (a, b) => shape.order(a) - shape.order(b),
  );
  const keys = new Set(keySentences);
  const collapseFolds = [...new Set((raw?.collapseFolds ?? []).filter(id => keys.has(id)))];

  // Section summaries, matched to sections by heading, in order for repeats.
  const sections = {};
  const taken = new Set();
  for (const { heading, summary } of raw?.sections ?? []) {
    const text = tidy(summary, shape);
    if (!text || words(text) > 90) continue;
    const wanted = squash(heading).toLowerCase();
    const match = shape.sections.find(
      section => !taken.has(section.index) && squash(section.heading).toLowerCase() === wanted,
    );
    if (!match) continue;
    taken.add(match.index);
    sections[match.index] = text;
  }

  // Chapters for an article without headings: each starts a paragraph, in order.
  let chapters = [];
  const headless = !shape.sections.some(section => section.hasHeading && !section.back);
  if (headless) {
    let last = 0;
    for (const chapter of raw?.chapters ?? []) {
      const start = shape.snap(chapter.start);
      const title = tidy(chapter.title, shape);
      const summary = tidy(chapter.summary, shape);
      if (!start || !title || words(title) > 10 || !summary || words(summary) > 90) continue;
      const at = shape.order(start);
      if (at <= last) continue;
      chapters.push({ start, title, summary });
      last = at;
    }
    if (chapters.length < 2) chapters = [];
    // The first chapter starts the article.
    if (chapters.length) chapters[0].start = shape.first;
  }
  if (chapters.length) for (const key of Object.keys(sections)) delete sections[key];

  return { keySentences, collapseFolds, sections, chapters };
}

export function checkLists(raw, shape, icons) {
  const groupings = {};
  for (const grouping of raw?.groupings ?? []) {
    const list = shape.lists.find(entry => entry.index === grouping.list);
    if (!list || list.items.length < 3) continue;
    const every = list.items.map((_, index) => index + 1).join();
    const by = [];
    for (const principle of grouping.by ?? []) {
      const groups = (principle.groups ?? [])
        .map(group => [
          tidy(group.name, shape).replace(/:$/, ''),
          [...new Set(group.items ?? [])].filter(Number.isInteger).sort((a, b) => a - b),
        ])
        .filter(([name, items]) => name && items.length);
      const placed = groups
        .flatMap(([, items]) => items)
        .sort((a, b) => a - b)
        .join();
      // Every item in exactly one group, or the principle is dropped.
      if (groups.length < 2 || placed !== every) continue;
      const edits = (principle.edits ?? [])
        .map(({ item, from, to }) => [item, String(from ?? ''), tidy(to, shape)])
        .filter(([item, from, to]) => from && to && list.items[item - 1]?.includes(from));
      const name = tidy(principle.name, shape);
      if (!name || words(name) > 10) continue;
      by.push({ name, about: tidy(principle.about, shape), groups, edits });
    }
    const sentence = tidy(grouping.sentence, shape);
    const asWritten = tidy(grouping.asWritten, shape);
    if (by.length && sentence && asWritten && words(sentence) <= 14) {
      groupings[list.index] = { sentence, asWritten, by };
    }
  }

  const carousels = {};
  for (const carousel of raw?.carousels ?? []) {
    const list = shape.lists.find(entry => entry.index === carousel.list);
    if (!list || list.items.length < 3 || list.items.length > 10) continue;
    // Cards only work when no item is too long to read on one.
    if (list.items.some(item => words(item) > 130)) continue;
    const chosen = list.items.map((_, index) => {
      const icon = carousel.icons?.[index];
      return icons.has(icon) ? icon : 'bookmark';
    });
    carousels[list.index] = { label: tidy(carousel.label, shape) || 'The list as cards', icons: chosen };
  }
  return { groupings, carousels };
}

// Bridges keyed by the fingerprint of the text each run hides.
export function checkBridges(raw, runs, shape = {}) {
  const bridges = {};
  for (const { run, text } of raw?.bridges ?? []) {
    const bridge = tidy(text, shape);
    if (runs[run]?.key && bridge && words(bridge) <= 22) bridges[runs[run].key] = bridge;
  }
  return bridges;
}

// What the checks need to know about an article model.
export function shapeOf(article) {
  const order = new Map(article.sentences.map(sentence => [sentence.id, sentence.n]));
  const opening = article.sections[0];
  const starts = new Map();
  for (const block of article.blocks) {
    if (block.sec !== opening?.index || !block.sentences.length) continue;
    // Only paragraphs and quotations that sit directly in the section start chapters.
    const top = block.el.parentElement === opening.body || block.el.parentElement?.parentElement === opening.body;
    if (!top) continue;
    starts.set(block.sentences[0].id, block);
  }
  // Whether the article sets its quotes curly, so the notes can match.
  const sample = article.sentences.slice(0, 400).map(s => s.text).join(' ');
  const curly = (sample.match(/[’‘“”]/g)?.length ?? 0) > (sample.match(/['"]/g)?.length ?? 0);
  return {
    curly,
    ids: new Set(order.keys()),
    order: id => order.get(id) ?? Infinity,
    first: article.sentences[0]?.id,
    sections: article.sections.map(section => ({
      index: section.index,
      heading: section.heading,
      hasHeading: Boolean(section.headingEl),
      back: Boolean(section.back),
    })),
    // The paragraph start at or just before a sentence, so a chapter never
    // splits a paragraph.
    snap(id) {
      const sentence = article.byId.get(id);
      if (!sentence || sentence.sec !== opening?.index) return null;
      for (let n = sentence.n; n >= 1; n--) {
        const candidate = `s${n}`;
        if (starts.has(candidate)) return candidate;
      }
      return null;
    },
    lists: article.lists.map(list => ({ index: list.index, items: list.texts })),
  };
}
