// Spine's background worker. It opens and closes the reader on a tab, and it is
// the only place that talks to Claude: the reader sends what it needs over a
// port, and the worker streams the reply back. The API key stays here, in the
// extension's storage, and never reaches a page.
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL, INPUTS, SCHEMAS, SYSTEMS } from './shared/prompts.js';
import { onPlan } from './shared/pricing.js';
import { ICONS } from './shared/lucide-icons.js';

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
  if (details.reason === 'install' && !SPINE_TEST) chrome.runtime.openOptionsPage();
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'spine-read') toggle(tab);
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'spine:options') {
    chrome.runtime.openOptionsPage();
    reply({ ok: true });
  } else if (message?.type === 'spine:settings') {
    settings().then(({ apiKey, baseURL, model }) =>
      reply({ ready: Boolean(apiKey || baseURL), model, billing: onPlan(baseURL) ? 'plan' : 'api' }),
    );
    return true;
  } else if (message?.type === 'spine:test-key') {
    testKey(message).then(reply);
    return true;
  }
  return false;
});

async function settings() {
  const { apiKey = '', baseURL = '', model = DEFAULT_MODEL } = await chrome.storage.local.get([
    'apiKey',
    'baseURL',
    'model',
  ]);
  return { apiKey: apiKey.trim(), baseURL: baseURL.trim(), model };
}

function client({ apiKey, baseURL }) {
  return new Anthropic({
    apiKey: apiKey || 'local-bridge',
    baseURL: baseURL || undefined,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  });
}

// What each kind of request costs in output, at most.
const MAX_TOKENS = { notes: 32000, lists: 16000, bridges: 16000 };

// Opus 5.5 and Sonnet 5.5 think adaptively, at medium effort, and fall back to
// another model if their safeguards decline a request; Haiku 4.5 does neither.
function request(kind, payload, model) {
  const input =
    kind === 'lists' ? INPUTS.lists(payload, Object.keys(ICONS)) : INPUTS[kind](payload);
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
    if (!config.apiKey && !config.baseURL) {
      port.postMessage({ type: 'error', code: 'no-key', message: 'Add your Anthropic API key in Spine’s settings.' });
      return;
    }
    const model = message.model || config.model;
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
