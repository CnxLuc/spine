// Spine for iPhone: a web app you add to your home screen. It keeps a library
// of the articles you add by link, opens each one in Spine's reader, and reads
// them on your ChatGPT plan, with a sign-in that Spine on your computer makes
// for it. Everything stays on the phone; only the article's page is fetched
// through Spine's server, which the phone can't do itself.
import { hooks, tell } from './install.js';
import { Reader, snapshotOf } from '../content/reader.js';
import { cleanBlock } from '../content/clean.js';
import { extractArticle } from '../content/extract.js';
import { loadFonts } from '../content/fonts.js';
import { giveConsent, loadNotes, loadPosition } from '../content/settings.js';
import { canonicalUrl, minutes } from '../content/text.js';
import * as chatgpt from '../chatgpt.js';
import { decodeHandoff } from '../shared/handoff.js';
import { SHARE_SERVER } from '../shares.js';
import { area, library } from './storage.js';
import STYLES from './app.css';

const local = area('local');
const app = document.getElementById('app');
document.head.append(Object.assign(document.createElement('style'), { textContent: STYLES }));

const el = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (className, text, action) => {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', action);
  return b;
};
const wait = ms => new Promise(done => setTimeout(done, ms));
// Safari and the home-screen app keep separate data, so connecting belongs in
// the app.
const installed = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

const fonts = loadFonts(file => new URL(`/reader/${file}`, location.origin).href);
let reader = null;
let wantConnect = false;

async function connected() {
  const [{ signedIn }, { shareKey = '' }] = await Promise.all([chatgpt.status(), local.get('shareKey')]);
  return signedIn && Boolean(shareKey);
}

// What shows: the way to connect until the phone is connected, then the library.
async function render() {
  if (wantConnect || !(await connected())) showConnect({ again: wantConnect });
  else showLibrary();
  wantConnect = false;
}

/* Connecting */

function showConnect({ again = false } = {}) {
  const view = el('section', 'connect');
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  const steps = el('ol', 'steps');
  for (const step of [
    ...(installed() ? [] : ['In Safari, select Share, then Add to Home Screen. Open Spine from your home screen and continue there.']),
    'On your Mac, open Spine’s settings and find Spine on your iPhone.',
    'Select Sign in for your iPhone, then Copy for your iPhone.',
    'Here, select Paste from your Mac.',
  ]) {
    steps.append(el('li', null, step));
  }
  const pasteBox = el('textarea', 'paste-box');
  pasteBox.placeholder = 'Or paste it here';
  pasteBox.rows = 3;
  pasteBox.spellcheck = false;
  pasteBox.setAttribute('autocapitalize', 'off');
  pasteBox.setAttribute('autocorrect', 'off');
  const connect = async text => {
    status.className = 'status';
    status.textContent = 'Connecting…';
    try {
      const handoff = decodeHandoff(text);
      await chatgpt.adopt(handoff.chatgpt);
      await local.set({ shareKey: handoff.key, shareServer: handoff.server, engine: 'chatgpt' });
      // Connecting ChatGPT is choosing it to read, as signing in is in the extension.
      await giveConsent();
      status.className = 'status ok';
      status.textContent = `Connected${handoff.chatgpt.email ? ` as ${handoff.chatgpt.email}` : ''}.`;
      await wait(700);
      if (reader?.article) {
        // The reader that asked can read now.
        await openArticle(await library.get(reader.article.key));
        return;
      }
      showLibrary();
    } catch (error) {
      status.className = 'status fail';
      status.textContent = error.message;
    }
  };
  const paste = button('primary wide', 'Paste from your Mac', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error('empty');
      await connect(text);
    } catch {
      status.className = 'status fail';
      status.textContent = 'Spine couldn’t read the clipboard. Paste it in the box instead.';
      pasteBox.focus();
    }
  });
  pasteBox.addEventListener('input', () => {
    if (/spine-iphone:[A-Za-z0-9_-]{40,}/.test(pasteBox.value)) connect(pasteBox.value);
  });
  view.append(
    el('h1', 'connect-title', again ? 'Connect ChatGPT again' : 'Spine'),
    el(
      'p',
      'lede',
      again
        ? 'ChatGPT signed Spine out. Make a new sign-in on your Mac and paste it here.'
        : 'Read long writing with its key sentences brought forward. Spine reads each article on your ChatGPT plan, and its reading counts toward your plan’s limits.',
    ),
    steps,
    paste,
    pasteBox,
    status,
  );
  if (again) view.append(button('ghost wide', 'Not now', () => showLibrary()));
  app.replaceChildren(view);
}

/* The library */

async function showLibrary() {
  const view = el('section', 'library');
  const head = el('header', 'top');
  head.append(
    el('h1', 'brand', 'Spine'),
    button('icon', '', () => showSettings()),
    button('primary add', 'Add', () => showAdd()),
  );
  head.querySelector('.icon').setAttribute('aria-label', 'Settings');
  head.querySelector('.icon').innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  view.append(head);
  if (!installed()) {
    view.append(el('p', 'hint', 'Add Spine to your home screen: select Share, then Add to Home Screen.'));
  }
  const articles = await library.list();
  if (!articles.length) {
    const empty = el('div', 'empty');
    empty.append(
      el('p', 'empty-title', 'Nothing to read yet'),
      el('p', null, 'Copy an article’s link, then select Add. Spine fetches it, and ChatGPT reads it the first time you open it.'),
    );
    view.append(empty);
  } else {
    const list = el('ul', 'list');
    for (const article of articles) list.append(await row(article));
    view.append(list);
  }
  app.replaceChildren(view);
}

async function row(article) {
  const item = el('li', 'row');
  const open = button('row-open', '', () => openArticle(article));
  const site = el('span', 'row-site');
  if (article.favicon) {
    const icon = el('img');
    icon.src = article.favicon;
    icon.alt = '';
    icon.referrerPolicy = 'no-referrer';
    icon.onerror = () => icon.remove();
    site.append(icon);
  }
  site.append(el('span', null, article.site || new URL(article.url).hostname));
  const [notes, place] = await Promise.all([loadNotes(article.id), loadPosition(article.id)]);
  const facts = [`${minutes(article.words)} min`];
  if (notes?.notes) facts.push('Key sentences ready');
  if (place?.ratio > 0.03) facts.push(place.ratio > 0.97 ? 'Finished' : `${Math.round(place.ratio * 100)}% read`);
  open.append(site, el('span', 'row-title', article.title), el('span', 'row-facts', facts.join(' · ')));
  const more = button('row-more', '', () => showActions(article));
  more.setAttribute('aria-label', `More for ${article.title}`);
  more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  item.append(open, more);
  return item;
}

/* Sheets */

function sheet(className, build) {
  const dialog = el('dialog', `sheet ${className}`);
  const close = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  // A tap on the dimmed page closes the sheet.
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  const body = el('div', 'sheet-body');
  build(body, close);
  dialog.append(body);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// The first web address in what was pasted, with https:// if it had none.
function linkIn(text) {
  const found = String(text).match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? String(text).trim().match(/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i)?.[0];
  if (!found) return null;
  try {
    const url = new URL(/^https?:/i.test(found) ? found : `https://${found}`);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function showAdd(prefill = '') {
  sheet('add', (body, close) => {
    const input = el('input', 'link');
    input.type = 'url';
    input.inputMode = 'url';
    input.placeholder = 'https://';
    input.value = prefill;
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.spellcheck = false;
    const status = el('p', 'status');
    status.setAttribute('role', 'status');
    const add = async text => {
      const url = linkIn(text ?? input.value);
      if (!url) {
        status.className = 'status fail';
        status.textContent = 'That isn’t a link. Copy the article’s link and try again.';
        return;
      }
      input.value = url;
      for (const control of body.querySelectorAll('button, input')) control.disabled = true;
      status.className = 'status';
      try {
        const article = await addArticle(url, step => (status.textContent = step));
        close();
        // iOS colours the status bar from what's on screen; give it the
        // library, not the sheet's dimmed page, before the reader covers it.
        await wait(300);
        await openArticle(article);
      } catch (error) {
        status.className = 'status fail';
        status.textContent = error.message;
        for (const control of body.querySelectorAll('button, input')) control.disabled = false;
      }
    };
    const form = el('form', 'add-form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      add();
    });
    const actions = el('div', 'actions');
    actions.append(
      button('ghost', 'Paste link', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (linkIn(text)) await add(text);
          else {
            status.className = 'status fail';
            status.textContent = 'There’s no link on the clipboard.';
          }
        } catch {
          input.focus();
        }
      }),
      Object.assign(el('button', 'primary', 'Add'), { type: 'submit' }),
    );
    form.append(input, actions);
    body.append(el('h2', null, 'Add an article'), form, status);
  });
}

function showActions(article) {
  sheet('actions', (body, close) => {
    const original = el('a', 'action', 'Open the original');
    original.href = article.url;
    original.target = '_blank';
    original.rel = 'noopener';
    const remove = button('action danger', 'Remove from Spine', async () => {
      await library.remove(article.id);
      close();
      showLibrary();
    });
    body.append(el('h2', 'clip', article.title), original, remove, button('action', 'Cancel', close));
  });
}

async function showSettings() {
  const account = await chatgpt.status();
  sheet('settings', (body, close) => {
    body.append(el('h2', null, 'Settings'));
    const who = el('p', 'fact', account.signedIn ? `Reading on your ChatGPT plan${account.email ? ` as ${account.email}` : ''}.` : 'ChatGPT isn’t connected.');
    const usage = el('a', 'action', 'Manage usage in ChatGPT');
    usage.href = 'https://chatgpt.com/settings/usage';
    usage.target = '_blank';
    usage.rel = 'noopener';
    body.append(
      who,
      usage,
      button('action', account.signedIn ? 'Connect again' : 'Connect ChatGPT', () => {
        close();
        showConnect({ again: account.signedIn });
      }),
    );
    if (account.signedIn) {
      body.append(
        button('action danger', 'Disconnect ChatGPT', async () => {
          await chatgpt.signOut();
          close();
          render();
        }),
      );
    }
    body.append(button('action', 'Done', close));
  });
}

/* Articles */

// The page at url, fetched by Spine's server, which the phone can't do itself.
async function fetchPage(url) {
  const { shareKey = '', shareServer = '' } = await local.get(['shareKey', 'shareServer']);
  const server = (shareServer || SHARE_SERVER).replace(/\/+$/, '');
  let response;
  try {
    response = await fetch(`${server}/api/fetch?url=${encodeURIComponent(url)}`, { headers: { authorization: `Bearer ${shareKey}` } });
  } catch {
    throw new Error('Spine couldn’t reach its server. Check your connection and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Spine couldn’t fetch that page (${response.status}).`);
  return data;
}

// Fetches the page, finds the article in it, and keeps the article as Spine
// found it.
async function addArticle(url, step) {
  step('Fetching the page…');
  const page = await fetchPage(url);
  step('Finding the article…');
  const doc = new DOMParser().parseFromString(page.html, 'text/html');
  const extracted = extractArticle(doc, { url: page.url || url });
  if (!extracted || !extracted.blocks.length) throw new Error('Spine couldn’t find an article on that page.');
  const meta = structuredClone(extracted.meta);
  const id = canonicalUrl(meta.url || page.url || url);
  const before = await library.get(id);
  const article = {
    id,
    url: meta.url || page.url || url,
    title: meta.title,
    site: meta.siteName,
    favicon: meta.favicon,
    words: extracted.words,
    addedAt: before?.addedAt ?? Date.now(),
    snapshot: { meta, blocks: extracted.blocks.map(snapshotOf), words: extracted.words },
  };
  await library.put(article);
  return article;
}

async function openArticle(article) {
  if (!article) return showLibrary();
  // Without a sign-in, ChatGPT can't read: connect first.
  if (!(await connected())) {
    showConnect({ again: true });
    return;
  }
  await Promise.race([fonts, wait(1200)]);
  reader ??= new Reader({ onClose: () => render() });
  if (SPINE_TEST) globalThis.__spineTest = reader;
  const { meta, blocks, words } = article.snapshot;
  await reader.openFound({ meta: structuredClone(meta), blocks: blocks.flatMap(cleanBlock), words });
  library.put({ ...article, openedAt: Date.now() }).catch(() => {});
}

// The reader asks to connect ChatGPT again when a sign-in stops working.
hooks.signIn = () => {
  wantConnect = true;
  if (reader?.layer.isOpen) reader.close();
  else render();
};
hooks.options = () => showSettings();
void tell;

if ('serviceWorker' in navigator && !SPINE_TEST) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(error => console.warn('Spine couldn’t work offline', error));
}
if (SPINE_TEST) {
  globalThis.__spineApp = { addArticle, openArticle, showLibrary, library, local };
  // The iPhone simulator can't reach into the page: #stand=<address> points
  // ChatGPT at a stand-in instead.
  const stand = new URLSearchParams(location.hash.slice(1)).get('stand');
  if (stand) local.set({ chatgptTest: { issuer: stand, api: `${stand}/v1` } });
}

render();
