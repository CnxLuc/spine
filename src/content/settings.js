// The reader's preferences, kept in the browser's synced storage so they follow
// the reader between machines. The API key and saved notes live in local
// storage instead, and only the background worker reads the key.

export const DEFAULTS = {
  theme: 'auto', // auto, paper, white, sepia, dusk, night
  font: 'newsreader', // newsreader, charter, sans
  size: 20,
  width: 'medium', // narrow, medium, wide
  leading: 'normal', // compact, normal, airy
  lens: 'skim', // read, skim, supercut, outline
  emphasis: true, // key sentences turn the accent color while scrolling
  bridges: true, // a short line in the author's voice inside folded text
  regroup: true, // offer other ways to group lists
  cards: false, // chunky lists as cards you slide through
  rail: true, // the outline beside the text on wide screens
  autoRead: true, // ask Claude for notes as soon as Spine opens
  minWords: 500, // don't ask for notes on articles shorter than this
  askAbove: 1, // ask first when an article would cost more than this many dollars; null never asks
  obsidianVault: '',
  obsidianFolder: 'Clippings',
};

export async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(changes) {
  try {
    await chrome.storage.sync.set(changes);
  } catch {
    // Storage can be unavailable; the choice still holds for this visit.
  }
}

// Whether the reader has agreed to Spine sending article text to Claude. Asked
// once, before the first article goes anywhere; version it if what Spine sends
// ever changes, so the reader is asked again.
const CONSENT_VERSION = 1;
export async function hasConsent() {
  try {
    const { consent } = await chrome.storage.local.get('consent');
    return consent?.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}
export async function giveConsent() {
  await chrome.storage.local.set({ consent: { version: CONSENT_VERSION, at: Date.now() } });
}
export async function withdrawConsent() {
  await chrome.storage.local.remove('consent');
}

// Saved notes, keyed by the article's address. Old entries are dropped so the
// store stays small.
const NOTES_PREFIX = 'notes:';
const POSITION_PREFIX = 'pos:';
const KEEP = 400;

export async function loadNotes(url) {
  try {
    const key = NOTES_PREFIX + url;
    return (await chrome.storage.local.get(key))[key] ?? null;
  } catch {
    return null;
  }
}

export async function saveNotes(url, notes) {
  try {
    await chrome.storage.local.set({ [NOTES_PREFIX + url]: { ...notes, savedAt: Date.now() } });
    const all = await chrome.storage.local.get(null);
    const saved = Object.entries(all)
      .filter(([key]) => key.startsWith(NOTES_PREFIX))
      .sort(([, a], [, b]) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    const stale = saved.slice(KEEP).map(([key]) => key);
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch (error) {
    console.warn('Spine couldn’t save notes', error);
  }
}

export async function loadPosition(url) {
  try {
    const key = POSITION_PREFIX + url;
    return (await chrome.storage.local.get(key))[key] ?? null;
  } catch {
    return null;
  }
}

export async function savePosition(url, position) {
  try {
    await chrome.storage.local.set({ [POSITION_PREFIX + url]: { ...position, at: Date.now() } });
  } catch {
    // Not worth interrupting reading for.
  }
}
