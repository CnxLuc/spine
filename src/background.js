// Spine's background worker. It opens and closes the reader on a tab, and it is
// the only place that talks to whoever reads: the reader sends what it needs
// over a port, and the worker streams the reply back. Keys and sign-ins stay
// here, in the extension's storage, and never reach a page.
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL, INPUTS, SCHEMAS, SYSTEMS } from './shared/prompts.js';
import { ICONS } from './shared/lucide-icons.js';
import * as chatgpt from './chatgpt.js';
import * as shares from './shares.js';
import { HOST, NAMES, PING, TOOLS, claudeReading, codexReading, describe, runRequest, unreachable } from './local.js';

// Opening Spine on a tab: ask the reader there to toggle, and if no reader is
// listening yet, add it first.
async function toggle(tab) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'spine:toggle' });
    return;
  } catch (error) {
    // Only a page with no reader yet gets one added.
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(error?.message))) {
      console.warn('Spine', error);
      return;
    }
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'spine:toggle' });
  } catch (error) {
    // Browser pages, the web store and some viewers don't allow extensions.
    console.warn('Spine could not open on this page', error);
    await chrome.action.setBadgeBackgroundColor({ color: '#8a8880', tabId: tab.id });
    await chrome.action.setBadgeText({ text: '–', tabId: tab.id });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Spine can’t read this page' });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '', tabId: tab.id }).catch(() => {});
      chrome.action.setTitle({ tabId: tab.id, title: 'Read with Spine (⌥⇧S)' }).catch(() => {});
    }, 2500);
  }
}

chrome.action.onClicked.addListener(toggle);
// The end-to-end tests open Spine without a click.
if (SPINE_TEST) globalThis.spineToggle = toggle;

chrome.runtime.onInstalled.addListener(details => {
  chrome.contextMenus.create({ id: 'spine-read', title: 'Read with Spine', contexts: ['page'] }, () =>
    void chrome.runtime.lastError,
  );
  // Once, on install: how to start.
  if (details.reason === 'install' && !SPINE_TEST) chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'spine-read') toggle(tab);
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'spine:options') {
    chrome.runtime.openOptionsPage();
    reply({ ok: true });
  } else if (message?.type === 'spine:settings') {
    settings()
      .then(async config => {
        const way = await engine(config);
        reply({ ready: way.ready, model: config.model, billing: way.kind === 'api' ? 'api' : 'plan', engine: way.kind });
      })
      .catch(() => reply({ ready: false }));
    return true;
  } else if (message?.type === 'spine:engine') {
    settings()
      .then(async config =>
        reply({
          choice: config.engine,
          ...(await engine(config, { fresh: Boolean(message.fresh) })),
          chatgpt: { ...(await chatgpt.status()), model: config.chatgptModel },
        }),
      )
      .catch(error => reply({ error: String(error) }));
    return true;
  } else if (message?.type === 'spine:sign-in') {
    // The answer comes later, as 'spine:connected', when the window closes.
    const from = sender.tab ? { tabId: sender.tab.id, windowId: sender.tab.windowId } : null;
    chatgpt.signIn(from).then(
      () => reply({ started: true }),
      error => reply({ started: false, message: error.message }),
    );
    return true;
  } else if (message?.type === 'spine:sign-out') {
    chatgpt.signOut().then(() => reply({ ok: true }));
    return true;
  } else if (message?.type === 'spine:chatgpt-models') {
    chatgpt.models({ fresh: Boolean(message.fresh) }).then(reply, () => reply([]));
    return true;
  } else if (message?.type === 'spine:test-key') {
    testKey(message).then(reply);
    return true;
  } else if (message?.type === 'spine:share-status') {
    shares.status(message.key).then(reply, () => reply({ ready: false, link: null }));
    return true;
  } else if (message?.type === 'spine:share') {
    shares.share(message).then(reply, error => reply({ ok: false, message: error.message }));
    return true;
  } else if (message?.type === 'spine:unshare') {
    shares.unshare(message.key).then(reply, error => reply({ ok: false, message: error.message }));
    return true;
  } else if (message?.type === 'spine:share-test') {
    shares.test(message).then(reply, error => reply({ ok: false, message: error.message }));
    return true;
  }
  return false;
});

async function settings() {
  const {
    apiKey = '',
    baseURL = '',
    model = DEFAULT_MODEL,
    engine = 'auto',
    chatgptModel = '',
  } = await chrome.storage.local.get(['apiKey', 'baseURL', 'model', 'engine', 'chatgptModel']);
  return { apiKey: apiKey.trim(), baseURL: baseURL.trim(), model, engine, chatgptModel };
}

// Claude Code or Codex on this computer, reached through Spine's connector
// (native/spine-host.sh), which the reader adds with one command. The browser
// starts the connector for each connection and only lets Spine in. It runs the
// reader's own, unmodified `claude -p` or `codex exec`, so reading uses their
// Claude or ChatGPT plan; Spine never sees their sign-in. local.js makes
// sense of what the tools print.
let found = null;

function probeLocal() {
  return new Promise(resolve => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch {
      resolve({ available: false, reason: 'unsupported' });
      return;
    }
    const finish = result => {
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ available: false, reason: 'timeout' }), 20000);
    // Anything but a pong is a connector too old to understand the ping.
    port.onMessage.addListener(message => finish(describe(message)));
    port.onDisconnect.addListener(() => finish({ available: false, reason: unreachable(chrome.runtime.lastError?.message) }));
    port.postMessage(PING);
  });
}

// What's on this computer, asked again at most once a minute.
async function local({ fresh = false } = {}) {
  if (!fresh && found && Date.now() - found.at < 60000) return found;
  found = { ...(await probeLocal()), at: Date.now() };
  return found;
}

// Which way Spine reads: the one the reader chose, or by default Claude Code,
// ChatGPT, then Codex, whichever is connected and signed in; otherwise the
// Anthropic API key.
async function engine(config, options) {
  const signedIn = async () => (await chatgpt.status()).signedIn;
  const keyed = Boolean(config.apiKey || config.baseURL);
  if (config.engine === 'chatgpt') return { kind: 'chatgpt', ready: await signedIn(), local: null };
  if (config.engine === 'api') return { kind: 'api', ready: keyed, local: null };
  const here = await local(options);
  const ready = kind => Boolean(here?.[TOOLS[kind]]?.signedIn);
  if (config.engine === 'claude-code' || config.engine === 'codex') return { kind: config.engine, ready: ready(config.engine), local: here };
  if (ready('claude-code')) return { kind: 'claude-code', ready: true, local: here };
  if (await signedIn()) return { kind: 'chatgpt', ready: true, local: here };
  if (ready('codex')) return { kind: 'codex', ready: true, local: here };
  return { kind: 'api', ready: keyed, local: here };
}

// Why Claude Code or Codex can't read yet, in a line. The same command fixes
// each of these.
function notReady({ kind, local: here }) {
  const name = NAMES[kind];
  if (!here?.available) return `${name} isn’t connected to Spine yet.`;
  if (here.outdated) return `Spine’s connection to ${name} needs updating.`;
  const tool = here[TOOLS[kind]];
  if (!tool) return `${name} isn’t installed on this computer.`;
  return `${name} isn’t signed in.`;
}

// Codex and ChatGPT answer in one go or stream quickly; they read the notes
// carefully and the rest quickly.
const effortFor = request => (request === 'notes' ? 'medium' : 'low');

function client({ apiKey, baseURL }) {
  return new Anthropic({
    apiKey: apiKey || 'unset',
    baseURL: baseURL || undefined,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  });
}

// What each kind of request costs in output, at most.
const MAX_TOKENS = { notes: 32000, lists: 16000, bridges: 16000 };

const inputFor = (kind, payload) =>
  kind === 'lists' ? INPUTS.lists(payload, Object.keys(ICONS)) : INPUTS[kind](payload);

// One read through Claude Code or Codex: the connector passes on what the tool
// prints as it prints it, and closing the reader's port stops it, which stops
// the tool.
function readLocally(port, signal, kind, request, payload, model) {
  const name = NAMES[kind];
  let native;
  try {
    native = chrome.runtime.connectNative(HOST);
  } catch {
    port.postMessage({ type: 'error', code: 'local-setup', message: `Spine can’t reach ${name} on this computer.` });
    return;
  }
  let settled = false;
  signal.addEventListener('abort', () => {
    settled = true;
    try {
      native.disconnect();
    } catch {}
  });
  const relay = message => {
    try {
      port.postMessage(message);
    } catch {}
  };
  const reading = kind === 'codex' ? codexReading() : claudeReading();
  native.onMessage.addListener(message => {
    if (settled) return;
    // The connector turned the request down, or is too old for this Spine.
    const refused = message?.type === 'refused' || (message?.type === 'error' && message.code === 'update');
    const out = refused ? [{ type: 'error', code: 'local-setup', message: `Spine’s connection to ${name} needs updating.` }] : reading(message);
    for (const next of out) {
      if (next.type === 'done') relay({ ...next, model: kind === 'codex' ? 'codex' : model, billing: 'plan' });
      else relay(next);
      if (next.type === 'done' || next.type === 'error') {
        settled = true;
        try {
          native.disconnect();
        } catch {}
      }
    }
  });
  native.onDisconnect.addListener(() => {
    if (!settled) {
      const reason = unreachable(chrome.runtime.lastError?.message);
      relay(
        reason === 'closed'
          ? { type: 'error', code: 'local', message: `${name} stopped before it finished. Try again.` }
          : { type: 'error', code: 'local-setup', message: `Spine can’t reach ${name} on this computer.` },
      );
    }
    settled = true;
  });
  native.postMessage(
    runRequest({
      engine: kind,
      model,
      effort: kind === 'codex' ? effortFor(request) : 'medium',
      system: SYSTEMS[request],
      user: inputFor(request, payload),
      schema: SCHEMAS[request],
    }),
  );
}

// Opus 5.5 and Sonnet 5.5 think adaptively, at medium effort, and fall back to
// another model if their safeguards decline a request; Haiku 4.5 does neither.
function request(kind, payload, model) {
  const input = inputFor(kind, payload);
  const body = {
    model,
    max_tokens: MAX_TOKENS[kind],
    system: SYSTEMS[kind],
    messages: [{ role: 'user', content: input }],
    output_config: { format: { type: 'json_schema', schema: SCHEMAS[kind] } },
  };
  if (/^claude-(opus|sonnet)-5/.test(model)) {
    body.thinking = { type: 'adaptive' };
    body.output_config.effort = 'medium';
    body.betas = ['server-side-fallback-2026-07-01'];
    body.fallbacks = 'default';
  }
  return body;
}

// A failure the reader can act on.
function explain(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return { code: 'auth', message: 'Your Anthropic API key was turned down. Check it in Spine’s settings.' };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { code: 'permission', message: 'Your API key can’t use this model. Pick another in Spine’s settings.' };
  }
  if (error instanceof Anthropic.NotFoundError) {
    return { code: 'model', message: 'That model isn’t available to your key. Pick another in Spine’s settings.' };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { code: 'rate', message: 'Claude is busy for your key right now. Try again in a minute.' };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { code: 'request', message: `Claude couldn’t take this article: ${error.message}` };
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionError) {
    return { code: 'network', message: 'Claude couldn’t be reached. Check your connection and try again.' };
  }
  if (error instanceof Anthropic.APIUserAbortError) return { code: 'aborted', message: 'Stopped.' };
  if (error instanceof Anthropic.APIError) {
    return { code: 'api', message: `Claude ran into a problem (${error.status ?? 'error'}). Try again in a moment.` };
  }
  return { code: 'unknown', message: error?.message || 'Something went wrong.' };
}

// One request per port: the reader sends { type: 'run', kind, payload } and
// gets back 'delta' messages as the reply streams, then 'done' or 'error'.
// Closing the port stops the request.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'spine-ai') return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async message => {
    if (message?.type !== 'run') return;
    const config = await settings();
    const way = await engine(config);
    const model = message.model || config.model;
    if (way.kind === 'chatgpt') {
      if (!way.ready) {
        port.postMessage({ type: 'error', code: 'chatgpt-signin', message: 'Sign in to ChatGPT to keep reading.' });
        return;
      }
      chatgpt.read(port, controller.signal, {
        request: message.kind,
        system: SYSTEMS[message.kind],
        user: inputFor(message.kind, message.payload),
        schema: SCHEMAS[message.kind],
        effort: effortFor(message.kind),
        model: config.chatgptModel,
      });
      return;
    }
    if (way.kind !== 'api') {
      if (!way.ready) {
        port.postMessage({ type: 'error', code: 'local-setup', message: notReady(way) });
        return;
      }
      readLocally(port, controller.signal, way.kind, message.kind, message.payload, model);
      return;
    }
    if (!config.apiKey && !config.baseURL) {
      port.postMessage({ type: 'error', code: 'no-key', message: 'Add your Anthropic API key in Spine’s settings.' });
      return;
    }
    try {
      const stream = client(config).beta.messages.stream(request(message.kind, message.payload, model), {
        signal: controller.signal,
      });
      let pending = '';
      let timer = null;
      const flush = () => {
        timer = null;
        if (!pending) return;
        port.postMessage({ type: 'delta', text: pending });
        pending = '';
      };
      stream.on('text', text => {
        pending += text;
        timer ??= setTimeout(flush, 60);
      });
      const final = await stream.finalMessage();
      clearTimeout(timer);
      flush();
      if (final.stop_reason === 'refusal') {
        port.postMessage({ type: 'error', code: 'refusal', message: 'Claude declined to read this article.' });
        return;
      }
      if (final.stop_reason === 'max_tokens') {
        port.postMessage({ type: 'error', code: 'too-long', message: 'This article is too long to read in one go.' });
        return;
      }
      const text = final.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
      port.postMessage({ type: 'done', text, model: final.model, usage: final.usage });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('Spine request failed', error);
      try {
        port.postMessage({ type: 'error', ...explain(error) });
      } catch {
        // The reader already left.
      }
    }
  });
});

// A tiny request that proves a key works with a model.
async function testKey({ apiKey, baseURL, model }) {
  try {
    const chosen = model || DEFAULT_MODEL;
    const reply = await client({ apiKey: apiKey?.trim(), baseURL: baseURL?.trim() }).messages.create({
      model: chosen,
      max_tokens: 256,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      ...(/^claude-(opus|sonnet)-5/.test(chosen) && { output_config: { effort: 'low' } }),
    });
    return { ok: true, model: reply.model };
  } catch (error) {
    return { ok: false, ...explain(error) };
  }
}
