// Spine's settings page. The key, model and API address live in local storage,
// which only this extension can read; reading preferences sync with the browser.
import { DEFAULTS, giveConsent, hasConsent, withdrawConsent } from '../content/settings.js';
import { DEFAULT_MODEL, MODELS } from '../shared/prompts.js';
import { money } from '../shared/pricing.js';

const $ = id => document.getElementById(id);

const local = await chrome.storage.local.get(['apiKey', 'model', 'baseURL']);
const synced = { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) };

// The key, with a short pause before saving while you type.
const key = $('apiKey');
key.value = local.apiKey ?? '';
let keyTimer;
key.addEventListener('input', () => {
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => chrome.storage.local.set({ apiKey: key.value.trim() }), 300);
  $('test-result').textContent = '';
});
$('reveal').addEventListener('click', () => {
  const hidden = key.type === 'password';
  key.type = hidden ? 'text' : 'password';
  $('reveal').textContent = hidden ? 'Hide' : 'Show';
});

const models = $('models');
for (const model of MODELS) {
  const label = document.createElement('label');
  label.className = 'model';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'model';
  input.value = model.id;
  input.checked = (local.model ?? DEFAULT_MODEL) === model.id;
  input.addEventListener('change', () => chrome.storage.local.set({ model: model.id }));
  const text = document.createElement('span');
  const name = document.createElement('b');
  name.textContent = model.name;
  const note = document.createElement('small');
  note.textContent = model.note;
  text.append(name, note);
  label.append(input, text);
  models.append(label);
}

const base = $('baseURL');
base.value = local.baseURL ?? '';
const showBridge = () => {
  $('bridge-note').hidden = !base.value.trim();
  $('bridge-address').textContent = base.value.trim();
  key.placeholder = base.value.trim() ? 'The bridge’s token' : 'sk-ant-…';
};
showBridge();
base.addEventListener('change', () => {
  chrome.storage.local.set({ baseURL: base.value.trim() });
  showBridge();
});

$('test').addEventListener('click', async () => {
  const result = $('test-result');
  result.className = 'result';
  result.textContent = 'Asking Claude…';
  const model = document.querySelector('input[name="model"]:checked')?.value ?? DEFAULT_MODEL;
  const reply = await chrome.runtime.sendMessage({
    type: 'spine:test-key',
    apiKey: key.value,
    baseURL: base.value,
    model,
  });
  result.className = `result ${reply?.ok ? 'ok' : 'fail'}`;
  result.textContent = reply?.ok ? `Works. ${reply.model} is ready to read.` : reply?.message ?? 'That didn’t work.';
});

// Reading preferences.
const lens = $('lens');
const markLens = value => {
  for (const button of lens.children) button.setAttribute('aria-checked', String(button.dataset.value === value));
};
markLens(synced.lens);
lens.addEventListener('click', event => {
  const value = event.target.closest('button')?.dataset.value;
  if (!value) return;
  markLens(value);
  chrome.storage.sync.set({ lens: value });
});

// Ask first above this many dollars, or never.
const askAbove = $('askAbove');
askAbove.value = synced.askAbove === null ? 'never' : String(synced.askAbove);
if (!askAbove.value) askAbove.value = '1';
askAbove.addEventListener('change', () =>
  chrome.storage.sync.set({ askAbove: askAbove.value === 'never' ? null : Number(askAbove.value) }),
);

const consent = $('consent');
consent.checked = await hasConsent();
consent.addEventListener('change', () => (consent.checked ? giveConsent() : withdrawConsent()));

const autoRead = $('autoRead');
autoRead.checked = synced.autoRead;
autoRead.addEventListener('change', () => chrome.storage.sync.set({ autoRead: autoRead.checked }));

const minWords = $('minWords');
minWords.value = synced.minWords;
minWords.addEventListener('change', () => {
  const value = Math.max(0, Math.round(Number(minWords.value) || 0));
  minWords.value = value;
  chrome.storage.sync.set({ minWords: value });
});

for (const name of ['obsidianVault', 'obsidianFolder']) {
  const input = $(name);
  input.value = synced[name];
  input.addEventListener('change', () => chrome.storage.sync.set({ [name]: input.value.trim() }));
}

// Saved notes.
async function count() {
  const all = await chrome.storage.local.get(null);
  const notes = Object.entries(all).filter(([name]) => name.startsWith('notes:'));
  const bytes = new Blob([JSON.stringify(Object.fromEntries(notes))]).size;
  // What reading them cost, on API credits; reads on a Claude plan cost nothing extra.
  const spent = notes.reduce((sum, [, saved]) => sum + (saved.billing === 'api' ? saved.cost ?? 0 : 0), 0);
  $('saved-count').textContent = notes.length
    ? `${notes.length} ${notes.length === 1 ? 'article' : 'articles'} read, ${(bytes / 1024).toFixed(0)} KB.${spent ? ` About ${money(spent)} of API credits so far.` : ''}`
    : 'No articles read yet.';
}
count();
$('clear').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(name => name.startsWith('notes:') || name.startsWith('pos:')));
  count();
});

$('shortcuts').addEventListener('click', event => {
  event.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

if (location.hash === '#claude') key.focus();
