// Spine's settings page. The key, model and API address live in local storage,
// which only this extension can read; reading preferences sync with the browser.
import { DEFAULTS, giveConsent, hasConsent, withdrawConsent } from '../content/settings.js';
import { DEFAULT_MODEL, MODELS } from '../shared/prompts.js';
import { money } from '../shared/pricing.js';
import { CHATGPT_LOGO } from '../shared/brands.js';
import { WINDOWS_COMMAND } from '../shared/commands.js';
import { encodeHandoff } from '../shared/handoff.js';
import { SHARE_SERVER } from '../shares.js';

const $ = id => document.getElementById(id);

// Spine for iPhone: a ChatGPT sign-in made here for the phone, copied as one
// line to paste there. The phone's tokens stay in this page until copied.
let phoneSession = null;
const phoneStatus = (text, tone = '') => {
  $('phone-status').className = `result ${tone}`.trim();
  $('phone-status').textContent = text;
};
const phoneKey = async () => (await chrome.storage.local.get('shareKey')).shareKey?.trim() ?? '';
$('phone-sign-in').insertAdjacentHTML('afterbegin', CHATGPT_LOGO);
$('phone-sign-in').addEventListener('click', async () => {
  if (!(await phoneKey())) {
    phoneStatus('Add your share key under Advanced first. Spine for iPhone uses it to fetch articles.', 'fail');
    return;
  }
  phoneSession = null;
  $('phone-copy').hidden = true;
  phoneStatus('Finish signing in in the window that opened.');
  const reply = await chrome.runtime.sendMessage({ type: 'spine:phone-sign-in' });
  if (!reply?.started) phoneStatus(reply?.message ?? 'Spine couldn’t open the ChatGPT sign-in.', 'fail');
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'spine:phone-connected') return;
  if (!message.ok) {
    phoneStatus(message.message, 'fail');
    return;
  }
  phoneSession = message.session;
  phoneStatus(`Signed in for your iPhone${phoneSession.email ? ` as ${phoneSession.email}` : ''}. Now copy it.`, 'ok');
  $('phone-copy').hidden = false;
});
$('phone-copy').addEventListener('click', async () => {
  if (!phoneSession) return;
  const { shareServer = '' } = await chrome.storage.local.get('shareServer');
  const text = encodeHandoff({ server: shareServer.trim() || SHARE_SERVER, key: await phoneKey(), chatgpt: phoneSession });
  try {
    await navigator.clipboard.writeText(text);
    phoneStatus('Copied. On your iPhone, open Spine and select Paste from your Mac.', 'ok');
  } catch {
    phoneStatus('Spine couldn’t copy it. Select Copy for your iPhone again.', 'fail');
  }
});

const local = await chrome.storage.local.get(['apiKey', 'model', 'baseURL', 'engine', 'shareKey', 'shareServer']);
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
  note.dataset.api = model.note;
  note.dataset.plan = model.planNote;
  text.append(name, note);
  label.append(input, text);
  models.append(label);
}

const base = $('baseURL');
base.value = local.baseURL ?? '';
base.addEventListener('change', () => chrome.storage.local.set({ baseURL: base.value.trim() }));

// Share links: a key for the share server, and the server, when it isn't Spine's.
const shareKey = $('shareKey');
const shareServer = $('shareServer');
shareKey.value = local.shareKey ?? '';
shareServer.value = local.shareServer ?? '';
shareServer.placeholder = SHARE_SERVER;
// Spine for iPhone needs the share server, so it shows only with a share key.
$('iphone').hidden = !shareKey.value.trim();
shareKey.addEventListener('input', () => {
  chrome.storage.local.set({ shareKey: shareKey.value.trim() });
  $('share-result').textContent = '';
  $('iphone').hidden = !shareKey.value.trim();
});
shareServer.addEventListener('change', () => chrome.storage.local.set({ shareServer: shareServer.value.trim() }));
$('share-test').addEventListener('click', async () => {
  const result = $('share-result');
  result.className = 'result';
  result.textContent = 'Asking the share server…';
  const reply = await chrome.runtime.sendMessage({ type: 'spine:share-test', key: shareKey.value, server: shareServer.value });
  result.className = `result ${reply?.ok ? 'ok' : 'fail'}`;
  result.textContent = reply?.ok ? 'Works. The share menu can make links now.' : reply?.message ?? 'That didn’t work.';
});

// Who reads: ChatGPT, signed in here, or Claude Code or Codex on this computer,
// on the reader's own plan; or an Anthropic API key. Unless the reader picks,
// Spine uses Claude Code, ChatGPT, then Codex, whichever is ready.
const setup = $('local-setup');
// kind is null while no one can read yet and the reader hasn't chosen.
function showEngine(kind) {
  for (const input of document.querySelectorAll('input[name="engine"]')) input.checked = input.value === kind;
  $('api-settings').hidden = kind !== 'api';
  // On a plan, models differ in how much of its limits they use, not in price.
  for (const note of document.querySelectorAll('.model small')) note.textContent = note.dataset[kind === 'api' ? 'api' : 'plan'];
  $('models-field').hidden = !kind || kind === 'codex' || kind === 'chatgpt';
  $('codex-model').hidden = kind !== 'codex';
  $('auto-hint').textContent =
    kind === 'api' ? 'Turn this off to choose which articles to spend API credits on.' : 'Turn this off to choose which articles are read.';
}
const platform = navigator.userAgentData?.platform ?? navigator.platform ?? '';
$('terminal-hint').hidden = !/^mac/i.test(platform);
$('windows-hint').hidden = !/^win/i.test(platform);
// Windows connects through PowerShell.
if (/^win/i.test(platform)) {
  $('local-command').textContent = WINDOWS_COMMAND;
  for (const shell of document.querySelectorAll('#local-setup .shell')) shell.textContent = 'PowerShell';
  for (const enter of document.querySelectorAll('#local-setup .enter')) enter.textContent = 'Enter';
}

// Where Claude Code or Codex stands, in a line.
function describe(element, tool, name) {
  if (!tool) {
    element.className = 'engine-status';
    element.textContent = name === 'Claude Code' ? 'Claude Code isn’t on this computer yet. The command below installs it.' : 'Codex isn’t installed on this computer.';
  } else if (tool.signedIn) {
    element.className = 'engine-status ok';
    element.textContent =
      tool.plan === 'API'
        ? `Connected: ${tool.version}, signed in with an API key, so reading uses your API credits.`
        : `Connected: ${tool.version}, signed in to your ${tool.plan} plan.`;
  } else {
    element.className = 'engine-status warn';
    element.textContent =
      name === 'Claude Code'
        ? 'Claude Code is here but not signed in. Run the command below to sign in.'
        : 'Codex is here but not signed in. Run codex login in Terminal, then check again.';
  }
}
const UNREACHABLE = {
  timeout: 'Didn’t answer. Check again in a moment.',
  forbidden: 'Connected for another copy of Spine. Run the command below to connect this one.',
};
async function checkLocal(fresh = false) {
  for (const id of ['claude-status', 'codex-status']) {
    $(id).className = 'engine-status';
    $(id).textContent = 'Checking…';
  }
  const state = await chrome.runtime.sendMessage({ type: 'spine:engine', fresh });
  const here = state.local ?? {};
  if (here.available && !here.outdated) {
    describe($('claude-status'), here.claude, 'Claude Code');
    describe($('codex-status'), here.codex, 'Codex');
    setup.hidden = Boolean(here.claude?.signedIn || (here.codex?.signedIn && state.kind === 'codex'));
  } else {
    const text = here.outdated ? 'Spine’s connection needs updating. Run the command below.' : UNREACHABLE[here.reason] ?? 'Not connected yet.';
    for (const id of ['claude-status', 'codex-status']) $(id).textContent = text;
    setup.hidden = false;
  }
  showChatGPT(state.chatgpt ?? {});
  showEngine(state.choice === 'auto' && !state.ready ? null : state.kind);
  return state;
}

// ChatGPT: the account, its models, and where to manage its usage.
$('chatgpt-sign-in').insertAdjacentHTML('afterbegin', CHATGPT_LOGO);
async function showChatGPT(account) {
  const status = $('chatgpt-status');
  status.className = `engine-status${account.signedIn ? ' ok' : ''}`;
  status.textContent = account.signedIn
    ? `Signed in${account.email ? ` as ${account.email}` : ''}. Using your ChatGPT plan.`
    : 'Not signed in yet.';
  $('chatgpt-sign-in').hidden = account.signedIn;
  $('chatgpt-account').hidden = !account.signedIn;
  if (!account.signedIn) return;
  const models = await chrome.runtime.sendMessage({ type: 'spine:chatgpt-models' });
  const select = $('chatgpt-model');
  select.replaceChildren(...(models ?? []).map(model => new Option(model.name, model.slug)));
  if (models?.some(model => model.slug === account.model)) select.value = account.model;
}
$('chatgpt-model').addEventListener('change', event => chrome.storage.local.set({ chatgptModel: event.target.value }));
$('chatgpt-sign-in').addEventListener('click', async () => {
  const status = $('chatgpt-status');
  status.className = 'engine-status';
  status.textContent = 'Finish signing in in the window that opened.';
  const reply = await chrome.runtime.sendMessage({ type: 'spine:sign-in' });
  if (!reply?.started) status.textContent = reply?.message ?? 'Spine couldn’t open the ChatGPT sign-in.';
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'spine:connected' || message.engine !== 'chatgpt') return;
  if (message.ok) checkLocal();
  else {
    $('chatgpt-status').className = 'engine-status warn';
    $('chatgpt-status').textContent = message.message;
  }
});
$('chatgpt-sign-out').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'spine:sign-out' });
  const { engine } = await chrome.storage.local.get('engine');
  if (engine === 'chatgpt') await chrome.storage.local.set({ engine: 'auto' });
  checkLocal();
});
for (const input of document.querySelectorAll('input[name="engine"]')) {
  input.addEventListener('change', () => {
    chrome.storage.local.set({ engine: input.value });
    showEngine(input.value);
  });
}
$('check-again').addEventListener('click', () => checkLocal(true));
$('copy-command').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('local-command').textContent);
  $('copy-command').textContent = 'Copied';
  setTimeout(() => ($('copy-command').textContent = 'Copy'), 1500);
});
showEngine(['api', 'codex', 'chatgpt', 'claude-code'].includes(local.engine) ? local.engine : null);
checkLocal();

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
