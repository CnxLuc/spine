// Reading an article with Claude, as three requests through the background
// worker:
//
// 1. notes: the key sentences, the ones that fold anyway, and a note for each
//    long section (or chapters, for an article without headings). It streams,
//    and key sentences light up as Claude chooses them.
// 2. lists: other ways to group the article's lists, and which become cards.
//    It runs alongside the notes.
// 3. bridges: as soon as the key sentences are settled, the runs that fold are
//    known, and Claude writes a bridge for the ones that need it while the
//    section notes are still coming.
//
// Everything is saved per article, keyed by its address and checked against a
// fingerprint of its sentences, so opening it again is instant and free. Only
// the parts that are missing are asked for again.
import { partialParse } from '@anthropic-ai/sdk/_vendor/partial-json-parser/parser.mjs';
import { checkBridges, checkLists, checkNotes, shapeOf } from './notes.js';
import { describe } from './article.js';
import { bridgeRequests } from './supercut.js';
import { hasConsent, loadNotes, saveNotes } from './settings.js';
import { costOf, estimate } from '../shared/pricing.js';
import { ICONS } from '../shared/lucide-icons.js';

const VERSION = 1;
const CLOSED_KEYS = /"keySentences"\s*:\s*\[[^\]]*\]/;
const CLOSED_FOLDS = /"collapseFolds"\s*:\s*\[[^\]]*\]/;

// One request: streams text through onText and resolves with the parsed reply.
function ask(kind, payload, onText, signal) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'spine-ai' });
    } catch (error) {
      reject(Object.assign(new Error('Spine was updated. Reload the page to keep reading.'), { code: 'stale' }));
      return;
    }
    let text = '';
    let settled = false;
    // Messages keep the background worker awake through long replies.
    const alive = setInterval(() => {
      try {
        port.postMessage({ type: 'ping' });
      } catch {}
    }, 15000);
    const finish = () => {
      settled = true;
      clearInterval(alive);
      signal?.removeEventListener('abort', abort);
      try {
        port.disconnect();
      } catch {}
    };
    const abort = () => {
      if (settled) return;
      finish();
      reject(Object.assign(new Error('Stopped.'), { code: 'aborted' }));
    };
    signal?.addEventListener('abort', abort);
    port.onMessage.addListener(message => {
      if (settled) return;
      if (message.type === 'delta') {
        text += message.text;
        onText?.(text);
      } else if (message.type === 'done') {
        finish();
        try {
          resolve({ json: JSON.parse(message.text || text), model: message.model, usage: message.usage });
        } catch {
          reject(Object.assign(new Error('Claude’s notes came back incomplete. Try again.'), { code: 'parse' }));
        }
      } else if (message.type === 'error') {
        finish();
        reject(Object.assign(new Error(message.message), { code: message.code }));
      }
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      finish();
      reject(Object.assign(new Error('The connection to Claude closed. Try again.'), { code: 'disconnected' }));
    });
    port.postMessage({ type: 'run', kind, payload });
  });
}

export class Analysis {
  constructor(reader) {
    this.reader = reader;
    this.article = reader.article;
    this.shape = shapeOf(this.article);
    this.controller = new AbortController();
    this.saved = null;
    this.spend = 0;
  }

  // What a reply cost, added to this article's total. On a Claude plan,
  // through Claude Code, nothing is billed to API credits.
  charge(reply) {
    if (this.billing === 'api') this.spend += costOf(reply.model, reply.usage, this.model);
  }

  cancel() {
    this.controller.abort();
  }

  // force reads the article again from scratch; approved means the reader
  // asked for this read, so Spine doesn't check with them again.
  async start({ force = false, approved = false } = {}) {
    const reader = this.reader;
    const article = this.article;
    const saved = force ? null : await loadNotes(article.key);
    const fresh = saved?.v === VERSION && saved.fingerprint === article.fingerprint ? saved : null;
    this.saved = fresh ?? { v: VERSION, fingerprint: article.fingerprint };

    // How this read is paid for, and about what a full read costs.
    const settings = await chrome.runtime.sendMessage({ type: 'spine:settings' }).catch(() => ({ ready: false }));
    this.model = settings.model;
    this.billing = settings.billing;
    const full = estimate(article.words, this.model);
    reader.cost = { billing: this.billing, engine: settings.engine, full, estimate: full };

    if (fresh?.notes) {
      reader.applyNotes(fresh.notes, { settled: true });
      if (fresh.lists) reader.applyLists(fresh.lists);
      if (fresh.bridges) reader.applyBridges(fresh.bridges);
      const asked = new Set(fresh.asked ?? []);
      const missingLists = !fresh.lists && article.lists.length;
      const missingBridges = reader.runs.some(run => !asked.has(run.key));
      if (!missingLists && !missingBridges) {
        reader.setAI('ready', {
          model: fresh.model,
          at: fresh.createdAt,
          cost: fresh.cost,
          billing: fresh.billing,
          engine: fresh.engine,
          cached: true,
        });
        return;
      }
    }

    if (!settings.ready) {
      if (!fresh?.notes) reader.setAI('no-key');
      return;
    }
    // A saved read that missed the lists or some bridges only asks for those.
    if (fresh?.notes) reader.cost.estimate = full * 0.45;
    // Nothing leaves the browser until the reader has said yes, once.
    if (!(await hasConsent())) {
      reader.setAI('consent', { force });
      return;
    }
    if (!fresh?.notes && !force && !approved && article.words < reader.settings.minWords) {
      reader.setAI('short');
      return;
    }
    // A long read on API credits waits for a yes.
    const limit = reader.settings.askAbove;
    if (this.billing === 'api' && !approved && limit !== null && reader.cost.estimate > limit) {
      reader.setAI('confirm', { force });
      return;
    }

    try {
      const jobs = [];
      if (!fresh?.notes) {
        reader.setAI('reading', { progress: 0 });
        jobs.push(this.notes());
      } else if (reader.runs.some(run => !new Set(fresh.asked ?? []).has(run.key))) {
        this.notesDone = true;
        jobs.push(this.bridges());
      }
      if (!fresh?.lists && article.lists.length) jobs.push(this.lists());
      await Promise.all(jobs);
      this.saved.createdAt = Date.now();
      this.saved.billing = this.billing;
      this.saved.engine = settings.engine;
      this.saved.cost = (fresh?.cost ?? 0) + this.spend;
      await saveNotes(article.key, this.saved);
      reader.setAI('ready', {
        model: this.saved.model,
        at: this.saved.createdAt,
        cost: this.saved.cost,
        billing: this.billing,
        engine: settings.engine,
      });
    } catch (error) {
      if (error.code === 'aborted') return;
      console.warn('Spine', error);
      reader.setAI('error', { message: error.message, code: error.code });
    }
  }

  // Asks Claude, and adds what the reply cost.
  async ask(kind, payload, onText) {
    const reply = await ask(kind, payload, onText, this.controller.signal);
    this.charge(reply);
    return reply;
  }

  // The notes, applied as they stream: key sentences light up as they arrive;
  // once the key sentences and folds are settled, the supercut is ready and the
  // bridges are asked for; section notes appear one by one.
  async notes() {
    const reader = this.reader;
    const total = this.article.sentences.length;
    const expected = Math.max(4, total * 0.34);
    let settled = false;
    let bridges = null;
    let lastKeys = 0;
    let lastSections = 0;
    let frame = 0;
    const onText = text => {
      if (frame) return;
      frame = setTimeout(() => {
        frame = 0;
        const partial = safeParse(text);
        const keys = partial?.keySentences ?? [];
        if (keys.length !== lastKeys) {
          lastKeys = keys.length;
          reader.streamKeys(keys);
          reader.setAI('reading', { progress: Math.min(0.85, (keys.length / expected) * 0.85) });
        }
        // The supercut can be built once both arrays have closed.
        if (!settled && CLOSED_KEYS.test(text) && CLOSED_FOLDS.test(text)) {
          settled = true;
          const checked = checkNotes(
            { keySentences: partial.keySentences, collapseFolds: partial.collapseFolds },
            this.shape,
          );
          reader.applyNotes(checked, { settled: true, partial: true });
          reader.setAI('reading', { progress: 0.88, phase: 'notes' });
          if (reader.runs.length) bridges = this.bridges();
        }
        const sections = (partial?.sections ?? []).filter(section => section.summary);
        if (sections.length !== lastSections) {
          lastSections = sections.length;
          const checked = checkNotes({ sections }, this.shape);
          for (const [index, summary] of Object.entries(checked.sections)) reader.applySection(Number(index), summary);
        }
      }, 120);
    };
    const reply = await this.ask('notes', describe(this.article), onText);
    clearTimeout(frame);
    const notes = checkNotes(reply.json, this.shape);
    this.saved.notes = notes;
    this.saved.model = reply.model;
    reader.applyNotes(notes, { settled: true });
    this.notesDone = true;
    if (!bridges && reader.runs.length) bridges = this.bridges();
    if (bridges) {
      reader.setAI('bridging', { progress: this.bridgeProgress ?? 0 });
      await bridges;
    }
  }

  // Bridges for the folds that haven't been asked about yet, in up to three
  // requests at once, in reading order, so the first ones arrive quickly. A
  // fold Claude decided needs no bridge counts as answered.
  async bridges() {
    const asked = new Set(this.saved.asked ?? []);
    const runs = this.reader.runs.filter(run => !asked.has(run.key));
    const requests = bridgeRequests(this.article, runs);
    this.saved.bridges ??= {};
    if (!requests.length) return;
    const parts = Math.min(3, Math.ceil(requests.length / 30));
    const size = Math.ceil(requests.length / parts);
    const chunks = [];
    for (let at = 0; at < requests.length; at += size) chunks.push(requests.slice(at, at + size));
    let done = 0;
    let failed = 0;
    this.bridgeProgress = 0;
    if (this.notesDone) this.reader.setAI('bridging', { progress: 0 });
    await Promise.all(
      chunks.map(async chunk => {
        const payload = {
          title: this.article.meta.title,
          byline: this.article.meta.byline,
          lang: this.article.meta.lang,
          runs: chunk,
        };
        try {
          const reply = await this.ask('bridges', payload, null);
          const found = checkBridges(reply.json, chunk, this.shape);
          Object.assign(this.saved.bridges, found);
          for (const request of chunk) asked.add(request.key);
          this.saved.asked = [...asked];
          this.reader.applyBridges(found, { fresh: true });
        } catch (error) {
          if (error.code === 'aborted') throw error;
          console.warn('Spine bridges', error);
          failed++;
        }
        this.bridgeProgress = ++done / chunks.length;
        if (this.notesDone && done < chunks.length) this.reader.setAI('bridging', { progress: this.bridgeProgress });
      }),
    );
    // The supercut works without bridges; say so and carry on.
    if (failed) this.reader.toast('Some bridges couldn’t be written this time. The folds still work.');
  }

  async lists() {
    const description = describe(this.article);
    const payload = {
      title: description.title,
      byline: description.byline,
      lang: description.lang,
      lists: description.lists,
    };
    try {
      const reply = await this.ask('lists', payload, null);
      const lists = checkLists(reply.json, this.shape, new Set(Object.keys(ICONS)));
      this.saved.lists = lists;
      this.reader.applyLists(lists);
    } catch (error) {
      if (error.code === 'aborted') throw error;
      console.warn('Spine lists', error);
    }
  }
}

function safeParse(text) {
  try {
    return partialParse(text);
  } catch {
    return null;
  }
}
