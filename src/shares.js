// Share links, for the background worker. An article goes to Spine's share
// server with its notes, and the server shows it at a short address, in Spine's
// reader, to anyone with the link. Only someone with the server's key can make,
// change or delete a link, and the key stays here, like the others.
export const SHARE_SERVER = 'https://read-with-spine.vercel.app';

// Each article's link, by its address: its id on the server, and a stamp of
// what it shows, so sharing it again unchanged is instant.
const RECORD = 'share:';

async function config() {
  const { shareKey = '', shareServer = '' } = await chrome.storage.local.get(['shareKey', 'shareServer']);
  return { key: shareKey.trim(), server: (shareServer.trim() || SHARE_SERVER).replace(/\/+$/, '') };
}

async function record(key) {
  return (await chrome.storage.local.get(RECORD + key))[RECORD + key] ?? null;
}

async function ask(path, { method = 'GET', body, key, server } = {}) {
  if (!key) throw new Error('Add your share key in Spine’s settings, under Advanced.');
  let response;
  try {
    response = await fetch(`${server}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Spine couldn’t reach the share server. Check your connection and try again.');
  }
  const reply = await response.json().catch(() => ({}));
  if (response.ok) return reply;
  const message =
    response.status === 401
      ? 'The share server didn’t accept your key. Check it in Spine’s settings.'
      : response.status === 413
        ? 'This article is too big to share.'
        : reply.error || `The share server answered ${response.status}. Try again.`;
  throw Object.assign(new Error(message), { status: response.status });
}

export async function status(key) {
  const [{ key: secret }, saved] = await Promise.all([config(), record(key)]);
  return { ready: Boolean(secret), link: saved?.url ?? null };
}

// A link for this article: the one it has, updated to show what the reader
// shows now, or a new one.
export async function share({ key, stamp, payload }) {
  const settings = await config();
  const saved = await record(key);
  let reply = null;
  if (saved?.id) {
    const at = `/api/share?id=${encodeURIComponent(saved.id)}`;
    try {
      // Unchanged, and still there (it may have been deleted from another browser).
      if (saved.stamp === stamp && (await ask(at, settings))) return { ok: true, url: saved.url };
      reply = await ask(at, { ...settings, method: 'PUT', body: payload });
    } catch (error) {
      // Gone: make a new one.
      if (error.status !== 404) throw error;
    }
  }
  const updated = Boolean(reply);
  reply ??= await ask('/api/share', { ...settings, method: 'POST', body: payload });
  await chrome.storage.local.set({ [RECORD + key]: { id: reply.id, url: reply.url, stamp, at: Date.now() } });
  return { ok: true, url: reply.url, updated };
}

export async function unshare(key) {
  const saved = await record(key);
  if (saved?.id) {
    try {
      await ask(`/api/share?id=${encodeURIComponent(saved.id)}`, { ...(await config()), method: 'DELETE' });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  await chrome.storage.local.remove(RECORD + key);
  return { ok: true };
}

// Checks a key against a server, for the settings page.
export async function test({ key = '', server = '' }) {
  await ask('/api/share', { key: key.trim(), server: (server.trim() || SHARE_SERVER).replace(/\/+$/, '') });
  return { ok: true };
}
