// Outline: each long section folds under a short note in the author's voice.
// The section's first lines show faded behind the note, which sits just below
// its first sentence or two; a click opens the section. An article without
// headings gets chapters Claude proposes, with titles that appear only here and
// in the rail beside the text. Adapted from Reading Long Form's section
// summaries (MIT).
import { textOf } from './article.js';
import { splitSentences, squash } from './text.js';

// Turns an article without headings into chapters: new sections start at each
// chapter's first paragraph, under a heading that shows only in the outline.
export function applyChapters(article, chapters) {
  const body = article.sections.filter(section => !section.back);
  if (!chapters.length || body.length !== 1 || body[0] !== article.sections[0]) return false;
  const opening = article.sections[0];
  const back = article.sections.slice(1);
  const tops = chapters.map(chapter => {
    let top = article.byId.get(chapter.start)?.block.el;
    while (top && top.parentElement !== opening.body) top = top.parentElement;
    return top;
  });
  if (tops.some(top => !top)) return false;

  const shell = (index, title) => {
    const section = document.createElement('section');
    section.className = 'sec';
    section.dataset.sec = index;
    const heading = document.createElement('h2');
    heading.className = 'sec-title synthetic';
    heading.id = `spine-sec-${index}`;
    heading.textContent = title;
    section.append(heading);
    return { section, heading };
  };

  const sections = [];
  chapters.forEach((chapter, index) => {
    if (index === 0) {
      const { heading } = shell(0, chapter.title);
      opening.el.prepend(heading);
      opening.headingEl = heading;
      opening.heading = chapter.title;
      opening.synthetic = true;
      sections.push(opening);
      return;
    }
    const { section, heading } = shell(index, chapter.title);
    const fold = opening.fold.cloneNode(false);
    const body = opening.body.cloneNode(false);
    const callout = opening.callout.cloneNode(true);
    fold.append(body, callout);
    section.append(fold);
    // Move this chapter's blocks out of the opening.
    const until = tops[index + 1] ?? null;
    let node = tops[index];
    while (node && node !== until) {
      const next = node.nextSibling;
      body.append(node);
      node = next;
    }
    sections.at(-1).el.after(section);
    sections.push({
      index,
      el: section,
      headingEl: heading,
      heading: chapter.title,
      synthetic: true,
      fold,
      body,
      callout,
      note: callout.querySelector('.callout-text'),
    });
  });

  // Notes and references follow the chapters, renumbered after them.
  for (const section of back) {
    section.index = sections.length;
    section.el.dataset.sec = section.index;
    if (section.headingEl) section.headingEl.id = `spine-sec-${section.index}`;
    sections.push(section);
  }
  // Rebuild which section each block and sentence belongs to.
  for (const section of sections) {
    if (section.back) continue;
    section.blocks = article.blocks.filter(block => section.body.contains(block.el));
    section.sentences = section.blocks.flatMap(block => block.sentences);
    section.words = section.sentences.reduce((sum, s) => sum + s.words, 0);
    for (const block of section.blocks) {
      block.sec = section.index;
      for (const sentence of block.sentences) sentence.sec = section.index;
    }
  }
  for (const list of article.lists) {
    const section = sections.find(s => s.body.contains(list.el));
    if (section) {
      list.sec = section.index;
      list.heading = section.heading;
    }
  }
  article.sections = sections;
  return true;
}

// The callout's top goes just below the line where the section's second
// sentence starts, so the opening sentence shows above it, and never more than
// a few lines down.
function calloutOffset(section) {
  const top = section.body.getBoundingClientRect().top;
  const line = parseFloat(getComputedStyle(section.body).lineHeight) || 32;
  let seen = 0;
  for (const block of section.body.querySelectorAll(':scope > p, :scope > ul > li, :scope > ol > li, :scope > blockquote > p')) {
    const { text, nodes } = textOf(block, 'sup.fn, .pill, .anchor, ul, ol');
    for (const sentence of splitSentences(text)) {
      const entry = nodes.findLast(({ start }) => start <= sentence.start);
      if (!entry) continue;
      const caret = document.createRange();
      caret.setStart(entry.node, Math.min(sentence.start - entry.start, entry.node.data.length));
      const rect = caret.getClientRects()[0];
      if (!rect || ++seen < 2) continue;
      return Math.min(line * 3.2, Math.max(line * 1.8, Math.round(rect.bottom - top + 8)));
    }
  }
  return null;
}

export class Outline {
  constructor(article, layer) {
    this.article = article;
    this.layer = layer;
    this.summaries = new Map();
    this.onClick = event => {
      if (!this.active()) return;
      const back = event.target.closest?.('.back-matter .sec-title');
      if (back) {
        back.closest('.sec').classList.toggle('open');
        return;
      }
      const fold = event.target.closest?.('.sec-fold');
      const section = fold && this.article.sections.find(s => s.fold === fold);
      if (section && this.summaries.has(section.index) && !section.el.classList.contains('open')) {
        event.preventDefault();
        this.open(section);
      }
    };
    this.onKey = event => {
      if (!this.active() || (event.key !== 'Enter' && event.key !== ' ')) return;
      const callout = event.target.closest?.('.callout');
      const section = callout && this.article.sections.find(s => s.callout === callout);
      if (section) {
        event.preventDefault();
        this.open(section);
      }
    };
    article.root.addEventListener('click', this.onClick);
    article.root.addEventListener('keydown', this.onKey);
  }

  active() {
    return this.layer.lens === 'outline';
  }

  set(index, summary) {
    const section = this.article.sections[index];
    if (!section || !summary) return;
    this.summaries.set(index, summary);
    section.note.textContent = summary;
    section.el.classList.add('foldable');
    section.callout.tabIndex = 0;
  }

  open(section) {
    const focused = section.callout.contains(this.layer.shadow.activeElement);
    section.el.classList.add('open');
    section.callout.setAttribute('aria-expanded', 'true');
    if (focused) section.headingEl?.focus?.({ preventScroll: true });
  }

  // Every section folds again, as when you first zoom out to the outline.
  foldAll() {
    for (const section of this.article.sections) {
      section.el.classList.remove('open');
      section.callout.setAttribute('aria-expanded', 'false');
    }
    this.place();
  }

  openAll() {
    for (const section of this.article.sections) this.open(section);
  }

  // Measures where each closed section's note goes. All are measured before any
  // moves, so the page lays out once.
  place() {
    if (!this.active()) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const closed = this.article.sections.filter(
        section => this.summaries.has(section.index) && !section.el.classList.contains('open'),
      );
      const offsets = closed.map(calloutOffset);
      closed.forEach((section, index) => {
        if (offsets[index] === null) section.fold.style.removeProperty('--fold-top');
        else section.fold.style.setProperty('--fold-top', `${offsets[index]}px`);
      });
    });
  }

  words() {
    // About what the outline asks you to read: headings, the first lines of each
    // section, and its note.
    let total = 0;
    for (const section of this.article.sections) {
      total += squash(section.heading).split(' ').length;
      const summary = this.summaries.get(section.index);
      if (summary) total += summary.split(/\s+/).length + Math.min(section.words, 30);
      else total += section.words;
    }
    return total;
  }

  stop() {
    this.article.root.removeEventListener('click', this.onClick);
    this.article.root.removeEventListener('keydown', this.onKey);
  }
}

// The outline beside the text: the title, then each section, with a hairline
// that fills as you read through it. Resting on a section shows its note.
export class Rail {
  constructor(article, reader, outline) {
    this.article = article;
    this.reader = reader;
    this.outline = outline;
    this.el = reader.layer.rail;
    this.note = reader.layer.railNote;
    this.build();
  }

  build() {
    const list = document.createElement('ol');
    const title = document.createElement('a');
    title.href = '#';
    title.className = 'title';
    title.textContent = this.article.meta.title;
    title.addEventListener('click', event => {
      event.preventDefault();
      this.reader.scrollTo(0);
    });
    const first = document.createElement('li');
    first.append(title);
    list.append(first);
    this.links = [];
    for (const section of this.article.sections) {
      if (!section.headingEl) continue;
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = '#';
      if (section.synthetic) {
        const mark = document.createElement('span');
        mark.className = 'synthetic-mark';
        mark.textContent = '✦';
        mark.title = 'A chapter Claude suggested';
        link.append(mark);
      }
      link.append(squash(section.heading));
      link.addEventListener('click', event => {
        event.preventDefault();
        this.reader.scrollToElement(section.el);
      });
      link.addEventListener('pointerenter', () => this.preview(section, link));
      link.addEventListener('pointerleave', () => this.note.classList.remove('shown'));
      item.append(link);
      list.append(item);
      this.links.push({ section, link });
    }
    this.el.replaceChildren(list);
    this.el.hidden = this.links.length < 2 || !this.reader.settings.rail;
  }

  preview(section, link) {
    const summary = this.outline.summaries.get(section.index);
    if (!summary) return;
    const label = document.createElement('b');
    label.textContent = section.synthetic ? 'Chapter note' : 'Section note';
    this.note.replaceChildren(label, summary);
    const rect = link.getBoundingClientRect();
    const host = this.reader.root.getBoundingClientRect();
    this.note.style.left = `${rect.right - host.left + 16}px`;
    this.note.style.top = `${Math.max(16, rect.top - host.top - 10)}px`;
    this.note.classList.add('shown');
  }

  // Which section you're in, and how far through each one you are.
  update(scrollTop, viewport) {
    if (this.el.hidden) return;
    const mark = scrollTop + viewport * 0.3;
    let current = null;
    for (const { section, link } of this.links) {
      const top = this.reader.offsetOf(section.el);
      const height = Math.max(1, section.el.offsetHeight);
      const done = Math.min(1, Math.max(0, (mark - top) / height));
      link.style.setProperty('--done', done.toFixed(3));
      if (top <= mark) current = link;
    }
    for (const { link } of this.links) link.classList.toggle('current', link === current);
  }
}
