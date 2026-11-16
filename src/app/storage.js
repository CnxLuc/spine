// Spine for iPhone keeps everything in the phone's own database for this site:
// the library of articles, and the reader's settings, notes and places, which
// the reader keeps through the same calls the extension makes to
// chrome.storage. A database rather than localStorage, which Safari caps at a
// few megabytes.
const NAME = 'spine-app';

let opened = null;
function database() {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('kv');
      request.result.createObjectStore('articles', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

const result = request =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const finished = transaction =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

// Every request in a transaction is made at once, before any await, so Safari
// never closes the transaction under them.
async function inStore(name, mode, work) {
  const transaction = (await database()).transaction(name, mode);
  const answer = work(transaction.objectStore(name));
  await finished(transaction);
  return answer;
}

// One area of chrome.storage, as the reader uses it: get with a key, a list
// of keys, an object of defaults or nothing for everything; set; remove; clear.
export function area(name) {
  const prefix = `${name}:`;
  const range = () => IDBKeyRange.bound(prefix, `${prefix}￿`);
  return {
    async get(keys = null) {
      const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
      const names = keys == null ? null : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const found = { ...defaults };
      if (names === null) {
        const [all, values] = await inStore('kv', 'readonly', store => [result(store.getAllKeys(range())), result(store.getAll(range()))]).then(
          pair => Promise.all(pair),
        );
        all.forEach((key, at) => (found[key.slice(prefix.length)] = values[at]));
        return found;
      }
      const values = await inStore('kv', 'readonly', store => names.map(key => result(store.get(prefix + key)))).then(list =>
        Promise.all(list),
      );
      names.forEach((key, at) => {
        if (values[at] !== undefined) found[key] = values[at];
      });
      return found;
    },
    async set(items) {
      await inStore('kv', 'readwrite', store => {
        for (const [key, value] of Object.entries(items)) {
          if (value !== undefined) store.put(value, prefix + key);
        }
      });
    },
    async remove(keys) {
      await inStore('kv', 'readwrite', store => {
        for (const key of [keys].flat()) store.delete(prefix + key);
      });
    },
    async clear() {
      await inStore('kv', 'readwrite', store => store.delete(range()));
    },
  };
}

// The library: each article as Spine first found it, so it opens again
// without the network, laid out the same way and fitting its notes.
export const library = {
  async list() {
    const all = await inStore('articles', 'readonly', store => result(store.getAll()));
    return (await all).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  },
  async get(id) {
    return (await inStore('articles', 'readonly', store => result(store.get(id)))) ?? null;
  },
  async put(article) {
    await inStore('articles', 'readwrite', store => store.put(article));
  },
  async remove(id) {
    await inStore('articles', 'readwrite', store => store.delete(id));
  },
};
