// The reader: finds the article on the page, lays it out in the layer, and runs
// the reading ideas on it. It owns the lens (how much of the text you see), the
// notes Claude writes, and everything you can change while reading.
import { extractArticle } from './extract.js';
import { buildArticle } from './article.js';
import { Layer } from './layer.js';
import {
  applyBridges,
  applyRuns,
  clearRuns,
  computeRuns,
  expandOnHover,
  supercutWords,
  toggleAll,
} from './supercut.js';
import { Outline, Rail, applyChapters } from './outline.js';
import { Cards, Regroup } from './lists.js';
import { Analysis } from './ai.js';
import { giveConsent, loadPosition, loadSettings, saveSettings, savePosition } from './settings.js';
import { canonicalUrl, minutes, squash } from './text.js';
import { icon } from './icons.js';
import * as exporter from './exporter.js';
import { money } from '../shared/pricing.js';

const LENSES = [
  { id: 'read', label: 'Read', about: 'Everything, as written' },
  { id: 'skim', label: 'Skim', about: 'Scroll, and the key sentences stay while the rest fades' },
  { id: 'supercut', label: 'Supercut', about: 'Only the key sentences; the rest folds into pills' },
  { id: 'outline', label: 'Outline', about: 'Each section folds under a short note' },
];
const THEMES = [
  { id: 'auto', label: 'Auto', bg: 'linear-gradient(135deg, #f0eee6 50%, #1f1e1d 50%)', ink: '#5e5d59' },
  { id: 'paper', label: 'Paper', bg: '#f0eee6', ink: '#1f1e1d' },
  { id: 'white', label: 'White', bg: '#ffffff', ink: '#1b1b1a' },
  { id: 'sepia', label: 'Sepia', bg: '#f4ead6', ink: '#3a2d20' },
  { id: 'dusk', label: 'Dusk', bg: '#1f1e1d', ink: '#efede5' },
  { id: 'night', label: 'Night', bg: '#000000', ink: '#dbd9d2' },
];
const sameSet = (a, b) => a.size === b.size && [...a].every(value => b.has(value));
const el = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export class Reader {
  constructor() {
    this.layer = new Layer();
    this.root = this.layer.root;
    this.settings = null;
    this.article = null;
    this.lens = 'read';
    this.keys = new Set();
    this.runKeys = null;
    this.runFolds = null;
    this.runs = [];
    this.bridges = {};
    this.lists = null;
    this.ai = { state: 'idle' };
    this.xray = false;
    this.systemDark = matchMedia('(prefers-color-scheme: dark)');
    this.systemDark.addEventListener('change', () => this.applyAppearance());

    const layer = this.layer;
    layer.on('close', () => this.close());
    layer.on('key', event => this.onKey(event));
    layer.on('keyup', event => {
      if (event.key === 'Alt') this.setXray(false);
    });
    layer.on('blur', () => this.setXray(false));
    layer.on('scroll', () => this.updateSkim());
    layer.on('rest', () => this.savePositionSoon());
    layer.on('frame', (top, height, read) => this.onFrame(top, height, read));
    layer.on('panel', (name, panel) => this.fillPanel(name, panel));
    this.buildDock();
  }

  async toggle() {
    if (this.layer.isOpen) this.close();
    else await this.open();
  }

  async open() {
    this.settings ??= await loadSettings();
    this.applyAppearance();
    this.layer.reveal();
    const href = location.href;
    if (!this.article || this.href !== href) {
      this.teardown();
      this.href = href;
      const extracted = extractArticle(document);
      if (!extracted) {
        this.showEmpty();
        this.layer.show();
        return;
      }
      this.mount(extracted);
      this.layer.show();
      await this.restorePosition();
      this.analysis = new Analysis(this);
      if (this.settings.autoRead) this.analysis.start();
      else this.setAI('paused');
      return;
    }
    this.layer.show();
  }

  close() {
    this.savePositionNow();
    this.setXray(false);
    this.layer.hide();
  }

  // Leaves the page entirely, for a newer version of Spine to take over.
  destroy() {
    try {
      this.analysis?.cancel();
    } catch {}
    this.layer.destroy();
  }

  teardown() {
    this.analysis?.cancel();
    this.hover?.stop();
    this.outline?.stop();
    this.regroup?.stop();
    this.cards?.stop();
    this.layer.scroller.replaceChildren();
    this.layer.rail.replaceChildren();
    this.article = null;
    this.keys = new Set();
    this.runKeys = null;
    this.runFolds = null;
    this.runs = [];
    this.bridges = {};
    this.lists = null;
    this.notes = null;
    this.root.classList.remove('has-keys', 'fades', 'skimming', 'emphasis', 'live');
  }

  showEmpty() {
    const empty = el('div', 'empty');
    const card = el('div', 'empty-card');
    card.append(
      el('h2', null, 'No article here'),
      el('p', null, 'Spine looks for a piece of writing on the page, like an essay, a post or a story, and couldn’t find one. You can still try to read the whole page.'),
    );
    const actions = el('div', 'actions');
    const force = el('button', 'button primary', 'Read the page anyway');
    force.addEventListener('click', () => {
      const extracted = extractArticle(document, { force: true });
      if (!extracted?.blocks.length) {
        this.layer.toast('There isn’t enough text on this page to read.');
        return;
      }
      this.teardown();
      this.mount(extracted);
      this.analysis = new Analysis(this);
      if (this.settings.autoRead) this.analysis.start({ force: true });
    });
    const close = el('button', 'button', 'Close');
    close.addEventListener('click', () => this.close());
    actions.append(force, close);
    card.append(actions);
    empty.append(card);
    this.layer.scroller.replaceChildren(empty);
    this.root.querySelector('.bar-name').textContent = location.hostname.replace(/^www\./, '');
    this.dockVisible(false);
  }

  mount(extracted) {
    const article = buildArticle(extracted);
    article.key = canonicalUrl(article.meta.url || location.href);
    this.article = article;
    const layer = this.layer;
    layer.scroller.replaceChildren(article.root);
    layer.scroller.scrollTop = 0;
    const site = this.root.querySelector('.bar-site');
    site.querySelector('img').src = article.meta.favicon;
    site.querySelector('img').onerror = event => (event.target.style.visibility = 'hidden');
    site.querySelector('.bar-name').textContent = article.meta.siteName;
    site.querySelector('.bar-title').textContent = article.meta.title;
    this.titleEl = article.root.querySelector('.doc-title');
    this.dockVisible(true);

    // Images: wide ones break out of the column a little; broken ones go away.
    const measure = () => this.article?.root.querySelector('.doc-body')?.clientWidth ?? 640;
    for (const img of article.root.querySelectorAll('figure img')) {
      const settle = () => {
        img.dataset.loaded = '';
        const figure = img.closest('figure');
        if (!figure || figure.classList.contains('gallery') || figure.classList.contains('embed')) return;
        // Only big pictures break out of the column: not ones the page sets small,
        // and not strips like a title set as an image.
        const declared = Number(img.getAttribute('width')) || Infinity;
        const wide =
          img.naturalWidth >= measure() * 1.25 &&
          declared >= measure() &&
          img.naturalHeight >= 240 &&
          img.naturalWidth / img.naturalHeight >= 1.2;
        figure.classList.toggle('wide', wide);
      };
      if (img.complete && img.naturalWidth) settle();
      else img.addEventListener('load', settle, { once: true });
      img.addEventListener('error', () => {
        const figure = img.closest('figure');
        if (figure?.querySelectorAll('img').length <= 1) figure.hidden = true;
        else img.hidden = true;
      }, { once: true });
    }

    this.outline = new Outline(article, this);
    this.rail = new Rail(article, this, this.outline);
    // Watched across the whole layer, so a run closes when the pointer leaves the text.
    this.hover = expandOnHover(this.root, () => this.lens === 'supercut');
    this.setLens(this.settings.lens, { anchor: false, remember: false });
    this.updateDock();
  }

  // Layer helpers the ideas use.
  get shadow() {
    return this.layer.shadow;
  }
  get scroller() {
    return this.layer.scroller;
  }
  get railNote() {
    return this.layer.railNote;
  }
  offsetOf(element) {
    return this.layer.offsetOf(element);
  }
  scrollTo(top) {
    this.layer.scrollTo(top);
  }
  scrollToElement(element) {
    this.layer.scrollToElement(element);
  }
  toast(message, options) {
    this.layer.toast(message, options);
  }

  /* Appearance */

  applyAppearance() {
    if (!this.settings) return;
    const { theme, font, size, width, leading } = this.settings;
    const resolved = theme === 'auto' ? (this.systemDark.matches ? 'dusk' : 'paper') : theme;
    this.root.classList.add('restyling');
    this.root.dataset.theme = resolved;
    this.root.dataset.font = font;
    this.root.dataset.width = width;
    this.root.dataset.leading = leading;
    this.root.style.setProperty('--size', `${size}px`);
    const em = { narrow: 29, medium: 33, wide: 38 }[width] ?? 33;
    const scale = { charter: 0.94, sans: 0.9 }[font] ?? 1;
    this.root.style.setProperty('--measure-px', `${Math.round(em * size * scale)}px`);
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.remove('restyling')));
    this.outline?.place();
  }

  set(name, value) {
    this.settings[name] = value;
    saveSettings({ [name]: value });
    if (['theme', 'font', 'size', 'width', 'leading'].includes(name)) {
      const anchor = this.captureAnchor();
      this.applyAppearance();
      if (anchor) requestAnimationFrame(() => this.restoreAnchor(anchor));
    } else if (name === 'emphasis') this.updateSkim();
    else if (name === 'bridges') {
      applyBridges(this.runs, this.bridges, { on: value });
      this.dispatchMarks();
      this.updateDock();
    } else if (name === 'regroup' || name === 'cards') this.startLists();
    else if (name === 'rail') this.rail?.build();
  }

  /* Lenses */

  buildDock() {
    this.lensButtons = {};
    for (const [index, lens] of LENSES.entries()) {
      const button = el('button');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.dataset.lens = lens.id;
      button.title = `${lens.about} (${index + 1})`;
      button.append(el('b', null, lens.label), el('small', null, ''));
      button.addEventListener('click', () => {
        if (button.classList.contains('unavailable')) {
          this.layer.togglePanel('intelligence', true);
          return;
        }
        this.setLens(lens.id);
      });
      this.layer.lensGroup.append(button);
      this.lensButtons[lens.id] = button;
    }
    new ResizeObserver(() => this.placeThumb()).observe(this.layer.lensGroup);
  }

  dockVisible(shown) {
    this.layer.dock.style.display = shown ? '' : 'none';
  }

  placeThumb() {
    const button = this.lensButtons[this.lens];
    if (!button) return;
    this.layer.lensThumb.style.width = `${button.offsetWidth}px`;
    this.layer.lensThumb.style.transform = `translateX(${button.offsetLeft}px)`;
  }

  setLens(lens, { anchor = true, remember = true } = {}) {
    if (!LENSES.some(entry => entry.id === lens)) lens = 'skim';
    if (remember) this.wantedLens = null;
    const keep = anchor && this.article ? this.captureAnchor() : null;
    this.hover?.close();
    this.lens = lens;
    this.root.dataset.lens = lens;
    if (lens === 'outline') this.outline?.foldAll();
    for (const [id, button] of Object.entries(this.lensButtons)) {
      button.setAttribute('aria-checked', String(id === lens));
    }
    this.placeThumb();
    this.updateSkim();
    if (keep) this.restoreAnchor(keep);
    if (remember) {
      this.settings.lens = lens;
      saveSettings({ lens });
    }
    this.updateMeter();
  }

  stepLens(direction) {
    const index = LENSES.findIndex(entry => entry.id === this.lens);
    const next = LENSES[Math.max(0, Math.min(LENSES.length - 1, index + direction))];
    if (next && !this.lensButtons[next.id].classList.contains('unavailable')) this.setLens(next.id);
  }

  // Skimming: the fades and the accent color, while you scroll or hold ⌥.
  updateSkim() {
    const hasKeys = this.keys.size > 0;
    const lensFades = this.lens === 'skim' || this.lens === 'outline';
    const fades = hasKeys && (lensFades || this.xray);
    this.root.classList.toggle('has-keys', hasKeys);
    this.root.classList.toggle('fades', fades);
    this.root.classList.toggle(
      'skimming',
      Boolean(fades && ((lensFades && this.layer.scrolling) || this.xray)),
    );
    this.root.classList.toggle('emphasis', Boolean(this.settings?.emphasis && (lensFades || this.xray)));
  }

  setXray(on) {
    if (this.xray === on) return;
    this.xray = on && this.keys.size > 0 && this.lens !== 'supercut';
    this.updateSkim();
  }

  // The sentence at the top of the screen, so changing how much shows never
  // loses your place.
  captureAnchor() {
    const scroller = this.layer.scroller;
    const box = scroller.getBoundingClientRect();
    const docBox = this.article?.root.querySelector('.doc-body')?.getBoundingClientRect();
    if (!docBox) return null;
    const x = docBox.left + Math.min(40, docBox.width / 3);
    for (let y = box.top + 110; y < box.top + box.height * 0.6; y += 18) {
      const hit = this.layer.shadow.elementFromPoint(x, y);
      const target = hit?.closest?.('.s, .pill, .callout, figure, h2, h3, h4, .tb, pre');
      if (!target || !this.article.root.contains(target)) continue;
      const sentence = target.closest('.s')?.dataset.s ?? target.querySelector?.('.s')?.dataset.s;
      return {
        sentence,
        element: target,
        offset: target.getBoundingClientRect().top - box.top,
      };
    }
    return null;
  }

  restoreAnchor(anchor) {
    const scroller = this.layer.scroller;
    let target = null;
    const visible = element => element && element.getClientRects().length > 0;
    if (anchor.sentence) {
      const n = Number(anchor.sentence);
      for (const span of this.article.root.querySelectorAll(`.s[data-s="${n}"]`)) {
        if (visible(span)) {
          target = span;
          break;
        }
      }
      if (!target) {
        // Hidden in a fold: its pill, or the nearest visible sentence before it.
        const sentence = this.article.byId.get(`s${n}`);
        const run = sentence?.frags[0]?.dataset.run;
        if (run) target = [...this.article.root.querySelectorAll(`.pill[data-run="${run}"]`)].find(visible);
        for (let k = n - 1; !target && k >= 1 && k > n - 400; k--) {
          target = [...this.article.root.querySelectorAll(`.s[data-s="${k}"]`)].find(visible) ?? null;
        }
        // Inside a folded section: its note.
        if (!target && sentence) {
          const section = this.article.sections.find(s => s.index === sentence.sec);
          target = section && (visible(section.callout) ? section.callout : section.headingEl ?? section.el);
        }
      }
    } else if (visible(anchor.element)) target = anchor.element;
    if (!target) return;
    const box = scroller.getBoundingClientRect();
    const now = target.getBoundingClientRect().top - box.top;
    scroller.scrollTop += now - anchor.offset;
  }

  /* Notes from Claude */

  dispatchMarks() {
    cancelAnimationFrame(this.marksFrame);
    this.marksFrame = requestAnimationFrame(() =>
      this.article?.root.dispatchEvent(new CustomEvent('spine:marks')),
    );
  }

  // Key sentences as they stream in: each glows once as it's chosen.
  streamKeys(ids) {
    if (!this.article) return;
    this.root.classList.add('live');
    const fresh = [];
    for (const id of ids) {
      if (this.keys.has(id)) continue;
      const sentence = this.article.byId.get(id);
      if (!sentence) continue;
      this.keys.add(id);
      for (const frag of sentence.frags) {
        frag.classList.add('k', 'fresh');
        fresh.push(frag);
      }
    }
    setTimeout(() => fresh.forEach(frag => frag.classList.remove('fresh')), 1700);
    this.resumeLens();
    this.updateSkim();
    this.dispatchMarks();
    this.updateDock();
  }

  setKeys(keys) {
    this.keys = new Set(keys);
    for (const sentence of this.article.sentences) {
      const key = this.keys.has(sentence.id);
      for (const frag of sentence.frags) frag.classList.toggle('k', key);
    }
    this.resumeLens();
    this.updateSkim();
  }

  // Back to the lens the reader chose, once there are notes to show it with.
  resumeLens() {
    if (!this.wantedLens || !this.keys.size || this.lens !== 'read') return;
    const lens = this.wantedLens;
    this.wantedLens = null;
    this.setLens(lens, { remember: false });
  }

  applyNotes(notes, { settled = false, partial = false } = {}) {
    if (!this.article) return;
    const keys = new Set(notes.keySentences ?? []);
    if (keys.size || !partial) this.setKeys(keys);
    if (settled && notes.collapseFolds) {
      const folds = new Set(notes.collapseFolds);
      if (!this.runKeys || !sameSet(keys, this.runKeys) || !sameSet(folds, this.runFolds)) {
        const anchor = this.lens === 'supercut' ? this.captureAnchor() : null;
        this.hover?.close();
        clearRuns(this.runs, this.article.root);
        this.runs = computeRuns(this.article, keys, folds);
        applyRuns(this.runs);
        applyBridges(this.runs, this.bridges, { on: this.settings.bridges });
        this.runKeys = keys;
        this.runFolds = folds;
        if (anchor) this.restoreAnchor(anchor);
      }
    }
    if (!partial) {
      this.notes = notes;
      if (notes.chapters?.length && !this.chaptered) {
        this.chaptered = applyChapters(this.article, notes.chapters);
        if (this.chaptered) {
          notes.chapters.forEach((chapter, index) => this.applySection(index, chapter.summary));
          this.rail.build();
        }
      }
      for (const [index, summary] of Object.entries(notes.sections ?? {})) this.applySection(Number(index), summary);
      this.addGistTime();
    }
    this.dispatchMarks();
    this.updateDock();
  }

  applySection(index, summary) {
    this.outline.set(index, summary);
    if (this.lens === 'outline') this.outline.place();
    this.updateDock();
  }

  applyBridges(bridges, { fresh = false } = {}) {
    this.bridges = { ...this.bridges, ...bridges };
    applyBridges(this.runs, this.bridges, { on: this.settings.bridges, fresh });
    this.dispatchMarks();
    this.addGistTime();
    this.updateDock();
  }

  applyLists(lists) {
    this.lists = lists;
    this.startLists();
  }

  startLists() {
    this.regroup?.stop();
    this.cards?.stop();
    this.regroup = null;
    this.cards = null;
    if (!this.lists || !this.article) return;
    if (this.settings.regroup && Object.keys(this.lists.groupings).length) {
      this.regroup = new Regroup(this.article, this.lists.groupings);
    }
    if (this.settings.cards && Object.keys(this.lists.carousels).length) {
      this.cards = new Cards(this.article, this.lists.carousels);
    }
  }

  setAI(state, detail = {}) {
    this.ai = { state, ...detail };
    this.root.dataset.ai = state;
    if (state === 'ready' || state === 'error') this.root.classList.remove('live');
    // Without notes, the lenses that need them show the text as written; the
    // chosen lens comes back as soon as notes arrive.
    if (['no-key', 'consent', 'confirm', 'error', 'short', 'paused'].includes(state) && !this.keys.size && this.lens !== 'read') {
      this.wantedLens = this.lens;
      this.setLens('read', { remember: false, anchor: false });
    }
    this.renderStatus();
    this.updateDock();
    if (!this.layer.panels.intelligence.hidden) this.fillPanel('intelligence', this.layer.panels.intelligence);
  }

  async consent() {
    await giveConsent();
    this.read(Boolean(this.ai.force));
  }

  // Who reads, in words: Claude (through Claude Code or the API) or Codex; the
  // tool on this computer; and the plan it runs on.
  get who() {
    return this.cost?.engine === 'codex' ? 'Codex' : 'Claude';
  }
  get tool() {
    return this.cost?.engine === 'codex' ? 'Codex' : 'Claude Code';
  }
  get plan() {
    return this.cost?.engine === 'codex' ? 'ChatGPT' : 'Claude';
  }

  // What reading this article costs, in words: on API credits, an estimate;
  // on a plan, nothing extra.
  costLine(prefix = 'about') {
    if (!this.cost) return '';
    if (this.cost.billing === 'plan') return `on your ${this.plan} plan`;
    return `${prefix} ${money(this.cost.estimate)} of your API credits`;
  }

  read(force = true) {
    this.analysis?.cancel();
    if (force) {
      // Start from the text alone.
      clearRuns(this.runs, this.article.root);
      this.runs = [];
      this.runKeys = null;
      this.bridges = {};
      this.setKeys([]);
      this.outline.summaries.clear();
      for (const section of this.article.sections) section.el.classList.remove('foldable', 'open');
    }
    this.analysis = new Analysis(this);
    this.analysis.start({ force, approved: true });
  }

  renderStatus() {
    const status = this.layer.status;
    clearTimeout(this.statusTimer);
    const { state } = this.ai;
    const spark = `<span class="spark">${icon('sparkles')}</span>`;
    status.classList.remove('leaving', 'ask');
    const show = () => (status.hidden = false);
    const leave = after => {
      this.statusTimer = setTimeout(() => {
        status.classList.add('leaving');
        this.statusTimer = setTimeout(() => (status.hidden = true), 300);
      }, after);
    };
    if (state === 'reading') {
      const progress = this.ai.progress ?? 0;
      status.innerHTML = `${spark}<span>${progress > 0.86 ? 'Writing section notes' : `${this.who} is reading`}</span><span class="meter"><i></i></span><span class="cost"></span>`;
      status.querySelector('.cost').textContent = this.cost?.billing === 'api' ? `~${money(this.cost.estimate)}` : '';
      status.querySelector('.meter i').style.setProperty('--p', Math.max(0.04, progress));
      show();
    } else if (state === 'bridging') {
      status.innerHTML = `${spark}<span>Writing bridges for the folds</span><span class="meter"><i></i></span>`;
      status.querySelector('.meter i').style.setProperty('--p', 0.9 + 0.1 * (this.ai.progress ?? 0));
      show();
    } else if (state === 'ready' && !this.ai.cached) {
      const cut = this.lensMinutes('supercut');
      const spent = this.ai.billing === 'api' && this.ai.cost ? ` · ${money(this.ai.cost)} of API credits` : '';
      status.innerHTML = `${spark}<span></span>`;
      status.querySelector('span:last-child').textContent = `Ready${spent}${cut ? ` · the supercut takes ${cut} min` : ''}`;
      show();
      leave(3600);
    } else if (state === 'error') {
      status.innerHTML = `${spark}<span></span>`;
      status.querySelector('span:last-child').textContent = this.ai.message;
      const retry = el('button', null, 'Try again');
      retry.addEventListener('click', () => this.read(false));
      status.append(retry);
      show();
    } else if (state === 'consent') {
      status.classList.add('ask');
      status.innerHTML = `${spark}<span></span>`;
      status.querySelector('span:last-child').textContent =
        this.cost?.billing === 'plan'
          ? `Read with ${this.who}? Spine asks ${this.tool} on this computer to read each article you open, on your ${this.plan} plan.`
          : `Read with Claude? Each article you open is sent to Anthropic and billed to your API credits. This one: about ${money(this.cost?.estimate ?? 0)}.`;
      const yes = el('button', 'yes', `Read with ${this.who}`);
      yes.addEventListener('click', () => this.consent());
      const no = el('button', null, 'Not now');
      no.addEventListener('click', () => {
        status.classList.remove('ask');
        this.setAI('paused');
      });
      status.append(yes, no);
      show();
    } else if (state === 'confirm') {
      status.classList.add('ask');
      status.innerHTML = `${spark}<span></span>`;
      status.querySelector('span:last-child').textContent = `A long one: reading it costs ${this.costLine()}.`;
      const yes = el('button', 'yes', 'Read it');
      yes.addEventListener('click', () => this.read(Boolean(this.ai.force)));
      const no = el('button', null, 'Not now');
      no.addEventListener('click', () => {
        status.classList.remove('ask');
        this.setAI('paused');
      });
      status.append(yes, no);
      show();
    } else if (state === 'no-key') {
      status.innerHTML = `${spark}<span>Connect Claude Code, Codex or an API key to bring the key sentences forward</span>`;
      const open = el('button', null, 'Settings');
      open.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'spine:options' }));
      status.append(open);
      show();
      leave(9000);
    } else {
      status.hidden = true;
    }
  }

  /* The dock and the meter */

  lensMinutes(lens) {
    const article = this.article;
    if (!article) return null;
    if (lens === 'read') return minutes(article.words);
    if (lens === 'skim') {
      if (!this.keys.size) return null;
      const words = article.sentences.reduce(
        (sum, sentence) => sum + (this.keys.has(sentence.id) || sentence.lead ? sentence.words : 0),
        0,
      );
      return minutes(words);
    }
    if (lens === 'supercut') {
      if (!this.runKeys) return null;
      return minutes(supercutWords(article, this.runs, this.bridges, this.settings.bridges));
    }
    if (lens === 'outline') {
      if (!this.outline?.summaries.size) return null;
      return minutes(this.outline.words());
    }
    return null;
  }

  updateDock() {
    if (!this.article) return;
    const state = this.ai.state;
    const working = state === 'reading' || state === 'bridging';
    const stopped = ['no-key', 'consent', 'confirm', 'error', 'short', 'paused'].includes(state);
    for (const lens of LENSES) {
      const button = this.lensButtons[lens.id];
      const time = this.lensMinutes(lens.id);
      const small = button.querySelector('small');
      const done = state === 'ready';
      const ready = time !== null;
      button.classList.toggle('waiting', !ready && working);
      const outlineEmpty = lens.id === 'outline' && done && !ready;
      button.classList.toggle('unavailable', lens.id !== 'read' && !ready && (stopped || outlineEmpty));
      small.textContent = ready ? `${time} min` : working ? '' : '—';
      if (lens.id === 'outline' && outlineEmpty) button.title = 'This piece has no sections long enough to fold';
      else button.title = `${lens.about} (${LENSES.indexOf(lens) + 1})`;
    }
    this.placeThumb();
    this.updateMeter();
  }

  addGistTime() {
    const byline = this.article?.root.querySelector('.doc-byline');
    if (!byline) return;
    byline.querySelector('.gist-time')?.previousElementSibling?.remove();
    byline.querySelector('.gist-time')?.remove();
    const cut = this.lensMinutes('supercut');
    if (!cut) return;
    byline.append(el('span', 'sep', '·'), el('span', 'gist-time', `${cut} min supercut`));
  }

  onFrame(top, height, read) {
    if (!this.article) return;
    const bar = 56;
    if (this.titleEl) {
      const titleBottom = this.titleEl.getBoundingClientRect().bottom - this.layer.scroller.getBoundingClientRect().top;
      this.root.classList.toggle('past-title', titleBottom < bar);
    }
    this.rail?.update(top, height);
    this.updateMeter(read);
  }

  updateMeter(fraction) {
    if (!this.article) return;
    const scroller = this.layer.scroller;
    if (fraction === undefined) {
      const max = scroller.scrollHeight - scroller.clientHeight;
      fraction = max > 0 ? Math.min(1, scroller.scrollTop / max) : 0;
    }
    const total = this.lensMinutes(this.lens) ?? this.lensMinutes('read');
    const left = Math.max(0, Math.round(total * (1 - fraction)));
    this.layer.meter.textContent = fraction > 0.985 ? 'Finished' : `${Math.round(fraction * 100)}% · ${left} min left`;
  }

  /* Reading position */

  topSentence() {
    const anchor = this.captureAnchor();
    return anchor?.sentence ? Number(anchor.sentence) : null;
  }

  savePositionSoon() {
    clearTimeout(this.positionTimer);
    this.positionTimer = setTimeout(() => this.savePositionNow(), 700);
  }

  savePositionNow() {
    if (!this.article || !this.layer.isOpen) return;
    const scroller = this.layer.scroller;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const ratio = max > 0 ? scroller.scrollTop / max : 0;
    savePosition(this.article.key, { n: this.topSentence(), ratio });
  }

  async restorePosition() {
    const saved = await loadPosition(this.article.key);
    if (!saved || saved.ratio < 0.03 || saved.ratio > 0.97) return;
    requestAnimationFrame(() => {
      const target = saved.n && [...this.article.root.querySelectorAll(`.s[data-s="${saved.n}"]`)].find(span => span.getClientRects().length);
      const scroller = this.layer.scroller;
      if (target) scroller.scrollTop = Math.max(0, this.layer.offsetOf(target) - 110);
      else scroller.scrollTop = saved.ratio * (scroller.scrollHeight - scroller.clientHeight);
      this.layer.toast('Picked up where you left off', {
        label: 'Start over',
        action: () => this.layer.scrollTo(0),
        duration: 5000,
      });
    });
  }

  /* Keys */

  onKey(event) {
    const { key } = event;
    if (key === 'Alt') {
      if (!event.repeat) this.setXray(true);
      return false;
    }
    if (event.metaKey || event.ctrlKey) return false;
    const target = event.composedPath()[0];
    if (target?.matches?.('input, textarea, select, [contenteditable]')) return false;
    if (key === 'Escape') {
      if (this.layer.closeLightbox()) return true;
      if (!this.layer.help.hidden) return this.layer.toggleHelp(false) || true;
      if (this.layer.closePanels()) return true;
      if (this.hover?.isOpen) {
        this.hover.close();
        return true;
      }
      this.close();
      return true;
    }
    if (event.altKey) return false;
    const lensIndex = ['1', '2', '3', '4'].indexOf(key);
    if (lensIndex > -1) {
      const lens = LENSES[lensIndex];
      if (this.lensButtons[lens.id].classList.contains('unavailable')) this.layer.togglePanel('intelligence', true);
      else this.setLens(lens.id);
      return true;
    }
    switch (key) {
      case ']':
        this.stepLens(1);
        return true;
      case '[':
        this.stepLens(-1);
        return true;
      case '=':
      case '+':
        this.set('size', Math.min(30, this.settings.size + 1));
        return true;
      case '-':
      case '_':
        this.set('size', Math.max(14, this.settings.size - 1));
        return true;
      case 't': {
        // From whatever shows now to the next theme that looks different.
        const order = ['paper', 'white', 'sepia', 'dusk', 'night'];
        this.set('theme', order[(order.indexOf(this.root.dataset.theme) + 1) % order.length]);
        this.layer.toast(`${THEMES.find(theme => theme.id === this.settings.theme).label} theme`, { duration: 1200 });
        return true;
      }
      case 'o':
        this.set('rail', !this.settings.rail);
        return true;
      case 'e':
        if (this.lens === 'supercut') toggleAll(this.article.root);
        else if (this.lens === 'outline') {
          const allOpen = this.article.sections.every(s => !this.outline.summaries.has(s.index) || s.el.classList.contains('open'));
          if (allOpen) this.outline.foldAll();
          else this.outline.openAll();
        }
        return true;
      case 'j':
      case 'k':
        this.jumpSection(key === 'j' ? 1 : -1);
        return true;
      case '?':
        this.fillHelp();
        this.layer.toggleHelp();
        return true;
      default:
        return false;
    }
  }

  jumpSection(direction) {
    if (!this.article) return;
    const top = this.layer.scroller.scrollTop + 100;
    // Headings you can see; the untitled opening isn't a stop.
    const tops = this.article.sections
      .filter(section => section.headingEl?.getClientRects().length)
      .map(section => ({ section, at: this.layer.offsetOf(section.headingEl) }))
      .sort((a, b) => a.at - b.at);
    const next =
      direction > 0 ? tops.find(entry => entry.at > top + 4) : [...tops].reverse().find(entry => entry.at < top - 8);
    if (next) this.layer.scrollTo(Math.max(0, next.at - 80));
    else if (direction < 0) this.layer.scrollTo(0);
  }

  /* Panels */

  fillPanel(name, panel) {
    if (name === 'appearance') this.fillAppearance(panel);
    else if (name === 'intelligence') this.fillIntelligence(panel);
    else if (name === 'share') this.fillShare(panel);
  }

  segmented(options, current, onPick, className = '') {
    const group = el('div', `segmented ${className}`);
    group.setAttribute('role', 'radiogroup');
    for (const option of options) {
      const button = el('button', null, option.label);
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(option.id === current));
      if (option.font) button.style.fontFamily = option.font;
      button.addEventListener('click', () => {
        for (const other of group.children) other.setAttribute('aria-checked', 'false');
        button.setAttribute('aria-checked', 'true');
        onPick(option.id);
      });
      group.append(button);
    }
    return group;
  }

  fillAppearance(panel) {
    panel.replaceChildren();
    const themes = el('section');
    themes.append(el('h3', null, 'Theme'));
    const grid = el('div', 'themes');
    grid.setAttribute('role', 'radiogroup');
    for (const theme of THEMES) {
      const button = el('button', theme.id === 'auto' ? 'swatch auto' : 'swatch');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(theme.id === this.settings.theme));
      const chip = el('span', 'chip');
      chip.append(el('span', null, 'Aa'));
      chip.style.background = theme.bg;
      chip.style.color = theme.ink;
      button.append(chip, theme.label);
      button.addEventListener('click', () => {
        for (const other of grid.children) other.setAttribute('aria-checked', 'false');
        button.setAttribute('aria-checked', 'true');
        this.set('theme', theme.id);
      });
      grid.append(button);
    }
    themes.append(grid);

    const type = el('section');
    type.append(el('h3', null, 'Type'));
    const fontRow = el('div', 'row');
    fontRow.append(
      el('span', null, 'Font'),
      this.segmented(
        [
          { id: 'newsreader', label: 'Newsreader', font: "'Spine Newsreader', Georgia, serif" },
          { id: 'charter', label: 'Charter', font: 'Charter, Georgia, serif' },
          { id: 'sans', label: 'Sans', font: 'var(--font-ui)' },
        ],
        this.settings.font,
        id => this.set('font', id),
        'font-choice',
      ),
    );
    const sizeRow = el('div', 'row');
    const stepper = el('div', 'stepper');
    const smaller = el('button', null, 'A');
    smaller.style.fontSize = '13px';
    smaller.setAttribute('aria-label', 'Smaller text');
    const bigger = el('button', null, 'A');
    bigger.style.fontSize = '19px';
    bigger.setAttribute('aria-label', 'Larger text');
    const output = el('output', null, `${this.settings.size}px`);
    smaller.addEventListener('click', () => {
      this.set('size', Math.max(14, this.settings.size - 1));
      output.textContent = `${this.settings.size}px`;
    });
    bigger.addEventListener('click', () => {
      this.set('size', Math.min(30, this.settings.size + 1));
      output.textContent = `${this.settings.size}px`;
    });
    stepper.append(smaller, output, bigger);
    sizeRow.append(el('span', null, 'Size'), stepper);
    const widthRow = el('div', 'row');
    widthRow.append(
      el('span', null, 'Width'),
      this.segmented(
        [
          { id: 'narrow', label: 'Narrow' },
          { id: 'medium', label: 'Medium' },
          { id: 'wide', label: 'Wide' },
        ],
        this.settings.width,
        id => this.set('width', id),
      ),
    );
    const leadingRow = el('div', 'row');
    leadingRow.append(
      el('span', null, 'Spacing'),
      this.segmented(
        [
          { id: 'compact', label: 'Compact' },
          { id: 'normal', label: 'Normal' },
          { id: 'airy', label: 'Airy' },
        ],
        this.settings.leading,
        id => this.set('leading', id),
      ),
    );
    type.append(fontRow, sizeRow, widthRow, leadingRow);
    panel.append(themes, type);
  }

  switchRow(label, hint, name, { disabled = false } = {}) {
    const row = el('div', 'switch-row');
    const what = el('div', 'what', label);
    if (hint) what.append(el('small', null, hint));
    const toggle = el('button', 'switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(Boolean(this.settings[name])));
    toggle.setAttribute('aria-label', label);
    if (disabled) toggle.disabled = true;
    row.append(what, toggle);
    row.addEventListener('click', () => {
      if (disabled) return;
      const value = !this.settings[name];
      toggle.setAttribute('aria-checked', String(value));
      this.set(name, value);
    });
    return row;
  }

  fillIntelligence(panel) {
    panel.replaceChildren();
    const { state } = this.ai;
    const head = el('section');
    const box = el('div', 'ai-state');
    const glyph = el('div', 'glyph');
    glyph.innerHTML = icon('sparkles');
    const text = el('p');
    const actions = el('div', 'actions');
    const button = (label, primary, action) => {
      const b = el('button', primary ? 'button primary' : 'button', label);
      b.type = 'button';
      b.addEventListener('click', action);
      actions.append(b);
      return b;
    };
    const settingsButton = () => button('Settings', false, () => chrome.runtime.sendMessage({ type: 'spine:options' }));
    const strong = value => {
      const s = el('strong', null, value);
      text.append(s);
    };
    if (state === 'consent') {
      strong(`Read this with ${this.who}?`);
      text.append(
        this.cost?.billing === 'plan'
          ? `When you open an article, Spine asks ${this.tool} on this computer to read it, so it can pick the key sentences and write the notes. It runs on your ${this.plan} plan and counts toward its usage limits. Spine sends nothing else, and never sees your sign-in. You can turn this off in settings.`
          : `When you open an article, Spine sends its text to Anthropic’s API with your key, so Claude can pick the key sentences and write the notes. Anthropic bills it to your API credits, not a Claude.ai subscription: about ${money(this.cost?.estimate ?? 0)} for this one, once. It sends nothing else. You can turn this off in settings.`,
      );
      button(`Read with ${this.who}`, true, () => this.consent());
      settingsButton();
    } else if (state === 'confirm') {
      strong('A long one');
      text.append(`Reading it costs ${this.costLine()}. Spine asks first above ${money(this.settings.askAbove ?? 0)}; change that in settings.`);
      button('Read it', true, () => this.read(Boolean(this.ai.force)));
      settingsButton();
    } else if (state === 'no-key') {
      strong('Connect someone to read with');
      text.append('Spine reads with Claude Code or Codex on this computer, on your own plan, or with an Anthropic API key. Set one up to bring the key sentences forward, fold the rest and write a note for each section.');
      button('Set it up', true, () => chrome.runtime.sendMessage({ type: 'spine:options' }));
    } else if (state === 'reading' || state === 'bridging') {
      strong(state === 'reading' ? `${this.who} is reading this piece` : 'Writing bridges');
      text.append('Key sentences light up as they’re chosen. You can keep reading.');
      button('Stop', false, () => {
        this.analysis?.cancel();
        this.setAI('paused');
      });
    } else if (state === 'error') {
      strong(`${this.who} couldn’t read this piece`);
      text.append(this.ai.message ?? '');
      button('Try again', true, () => this.read(false));
      settingsButton();
    } else if (state === 'short') {
      strong('A short piece');
      text.append(`At ${this.article?.words ?? 0} words, Spine didn’t ask ${this.who} to read it. Reading it costs ${this.costLine()}.`);
      button('Read it anyway', true, () => this.read(true));
    } else if (state === 'paused') {
      strong('Not read yet');
      text.append(`Spine waits for you before asking ${this.who} to read.${this.cost ? ` Reading it costs ${this.costLine()}.` : ''}`);
      button(`Read with ${this.who}`, true, () => this.read(false));
      settingsButton();
    } else if (state === 'ready') {
      strong(this.ai.cached ? 'Notes saved from before' : 'Notes ready');
      const model = String(this.ai.model ?? '')
        .replace(/^codex$/, 'Codex')
        .replace(/^claude-/, 'Claude ')
        .replace(/-(\d)-(\d)$/, ' $1.$2')
        .replace(/-/g, ' ')
        .replace(/\b(opus|sonnet|haiku)\b/i, word => word[0].toUpperCase() + word.slice(1));
      const when = this.ai.at ? new Date(this.ai.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
      const spent =
        this.ai.billing === 'plan'
          ? `on your ${this.ai.engine === 'codex' ? 'ChatGPT' : 'Claude'} plan`
          : this.ai.cost
            ? `${money(this.ai.cost)} of API credits`
            : '';
      text.append([model, when, spent].filter(Boolean).join(' · ') || `Written by ${this.who}`);
      button(this.cost?.billing === 'api' ? `Read again, ~${money(this.cost.full)}` : 'Read again', false, () => this.read(true));
      settingsButton();
    } else {
      strong('Reading notes');
      text.append(`${this.who} hasn’t read this piece yet.`);
      button(`Read with ${this.who}`, true, () => this.read(false));
    }
    box.append(glyph, text);
    head.append(box, actions);

    const ideas = el('section');
    ideas.append(el('h3', null, 'Reading ideas'));
    ideas.append(
      this.switchRow('Accent the key sentences', 'While you skim, they turn the accent color', 'emphasis'),
      this.switchRow('Bridges in folded text', 'A line in the author’s voice inside each pill', 'bridges'),
      this.switchRow('Group lists other ways', 'A dropdown above lists that could be grouped differently', 'regroup'),
      this.switchRow('Lists as cards', 'Chunky lists become cards you slide through', 'cards'),
      this.switchRow('Outline beside the text', 'On wide screens. Press O', 'rail'),
    );
    const hint = el('p', 'kbd-hint');
    hint.innerHTML = 'Hold <kbd>⌥</kbd> to see the key sentences without scrolling. Press <kbd>?</kbd> for all shortcuts.';
    ideas.append(hint);
    panel.append(head, ideas);
  }

  async copy(text, message) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = el('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;opacity:0';
      this.layer.shadow.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    this.layer.closePanels();
    this.layer.toast(message);
  }

  fillShare(panel) {
    panel.replaceChildren();
    const article = this.article;
    const menu = el('div', 'menu');
    const item = (iconName, label, hint, action, enabled = true) => {
      const button = el('button');
      button.type = 'button';
      button.innerHTML = icon(iconName);
      const text = el('span', null, label);
      if (hint) text.append(el('small', null, hint));
      button.append(text);
      if (!enabled) {
        button.disabled = true;
        button.style.opacity = '0.45';
        button.style.cursor = 'default';
      } else button.addEventListener('click', action);
      menu.append(button);
    };
    if (!article) {
      panel.append(el('p', null, 'Nothing to share yet.'));
      return;
    }
    const supercut = () => exporter.supercutMarkdown(article, this.runs, this.bridges, this.settings.bridges);
    const outline = () => exporter.outlineMarkdown(article, this.outline.summaries);
    const head = exporter.header(article.meta);
    item('scissors', 'Copy the supercut', 'Key sentences and bridges, as Markdown', () =>
      this.copy(`${head}\n\n${supercut()}`, 'Supercut copied'), Boolean(this.runKeys));
    item('list', 'Copy the outline', 'Each section and its note', () =>
      this.copy(`${head}\n\n${outline()}`, 'Outline copied'), this.outline.summaries.size > 0);
    item('file-text', 'Copy as Markdown', 'The whole article, with images', () =>
      this.copy(`${head}\n\n${exporter.articleMarkdown(article)}`, 'Article copied'));
    menu.append(el('hr'));
    item('gem', 'Save to Obsidian', this.settings.obsidianVault ? `New note in ${this.settings.obsidianVault}` : 'New note in your open vault', () => {
      const note = exporter.obsidianNote(article, {
        outline: this.outline.summaries.size ? outline() : '',
        supercut: this.runKeys ? supercut() : '',
      });
      exporter.openInObsidian(note, article.meta.title, {
        vault: this.settings.obsidianVault,
        folder: this.settings.obsidianFolder,
      });
      this.layer.closePanels();
      this.layer.toast('Sent to Obsidian');
    });
    item('external-link', 'Open the original', article.meta.host, () => {
      window.open(article.meta.url, '_blank', 'noopener');
      this.layer.closePanels();
    });
    panel.append(menu);
  }

  fillHelp() {
    const keys = [
      [['1'], ['2'], ['3'], ['4']],
      [['['], [']']],
      [['⌥']],
      [['E']],
      [['J'], ['K']],
      [['O']],
      [['T']],
      [['−'], ['+']],
      [['Esc']],
    ];
    const what = [
      'Read, Skim, Supercut, Outline',
      'Show more or less of the text',
      'Hold to see the key sentences without scrolling',
      'Open or fold everything in Supercut and Outline',
      'Next or previous section',
      'Show or hide the outline beside the text',
      'Next theme',
      'Smaller or larger text',
      'Close a panel, or close Spine',
    ];
    const card = el('div', 'help-card');
    card.append(el('h2', null, 'Shortcuts'), el('p', null, 'Spine keeps the page’s own shortcuts out of your way while it’s open.'));
    const list = el('dl');
    keys.forEach((group, index) => {
      const dt = el('dt');
      for (const [label] of group) dt.append(el('kbd', null, label));
      list.append(dt, el('dd', null, what[index]));
    });
    card.append(list);
    this.layer.help.replaceChildren(card);
  }
}
