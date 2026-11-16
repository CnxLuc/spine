// What the extension's background worker does for the reader, done in the page
// for Spine for iPhone: storage, settings, sharing, and reading on the
// reader's ChatGPT plan, straight from the phone to OpenAI. The reader's code
// calls chrome.* as it does in the extension and doesn't know the difference.
import * as chatgpt from '../chatgpt.js';
import * as shares from '../shares.js';
import { INPUTS, SCHEMAS, SYSTEMS } from '../shared/prompts.js';
import { ICONS } from '../shared/lucide-icons.js';
import { area } from './storage.js';

// As the background worker asks: notes think harder than lists and bridges.
const effortFor = kind => (kind === 'notes' ? 'medium' : 'low');
const inputFor = (kind, payload) => (kind === 'lists' ? INPUTS.lists(payload, Object.keys(ICONS)) : INPUTS[kind](payload));

const events = () => {
  const listeners = new Set();
  return {
    listeners,
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn),
    hasListener: fn => listeners.has(fn),
  };
};

// signIn and options are the app's: where the reader goes to connect ChatGPT
// again, and to see the app's settings.
export function installChrome({ signIn, options }) {
  const local = area('local');
  const onMessage = events();

  async function answer(message) {
    switch (message?.type) {
      case 'spine:settings': {
        const { signedIn } = await chatgpt.status();
        return { ready: signedIn, model: 'chatgpt', billing: 'plan', engine: 'chatgpt' };
      }
      case 'spine:engine': {
        const account = await chatgpt.status();
        const { chatgptModel = '' } = await local.get('chatgptModel');
        return { choice: 'chatgpt', kind: 'chatgpt', ready: account.signedIn, chatgpt: { ...account, model: chatgptModel } };
      }
      case 'spine:sign-in':
        signIn();
        return { started: true };
      case 'spine:options':
        options();
        return { ok: true };
      case 'spine:chatgpt-models':
        return chatgpt.models({ fresh: Boolean(message.fresh) }).catch(() => []);
      case 'spine:share-status':
        return shares.status(message.key).catch(() => ({ ready: false, link: null }));
      case 'spine:share':
        return shares.share(message).catch(error => ({ ok: false, message: error.message }));
      case 'spine:unshare':
        return shares.unshare(message.key).catch(error => ({ ok: false, message: error.message }));
      default:
        return undefined;
    }
  }

  // One read per port, as in the extension: 'run' starts it, replies come back
  // as 'delta', then 'done' or 'error', and disconnecting stops it.
  function connect({ name } = {}) {
    const incoming = events();
    const controller = new AbortController();
    let open = true;
    const port = {
      name,
      onMessage: incoming,
      onDisconnect: events(),
      postMessage(message) {
        if (message?.type !== 'run' || name !== 'spine-ai') return;
        local.get('chatgptModel').then(({ chatgptModel = '' }) =>
          chatgpt.read(relay, controller.signal, {
            request: message.kind,
            system: SYSTEMS[message.kind],
            user: inputFor(message.kind, message.payload),
            schema: SCHEMAS[message.kind],
            effort: effortFor(message.kind),
            model: chatgptModel,
          }),
        );
      },
      disconnect() {
        open = false;
        controller.abort();
      },
    };
    // Replies arrive a moment later, as they do from a worker.
    const relay = {
      postMessage(message) {
        if (!open) return;
        queueMicrotask(() => {
          for (const listener of incoming.listeners) listener(message, port);
        });
      },
    };
    return port;
  }

  globalThis.chrome = {
    storage: { local, sync: area('sync'), onChanged: events() },
    runtime: {
      id: 'spine-for-iphone',
      getURL: file => new URL(`/reader/${file}`, location.origin).href,
      sendMessage: message => answer(message),
      connect,
      onMessage,
    },
  };
  // What the app tells the reader, as the worker would: a sign-in finished.
  return message => {
    for (const listener of onMessage.listeners) listener(message, {}, () => {});
  };
}
