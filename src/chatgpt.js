// Reading on the reader's ChatGPT plan, through Sign in with ChatGPT: OpenAI's
// sign-in for open-source apps that run on the reader's own computer.
// https://developers.openai.com/siwc/token-sharing-open-source
//
// Spine signs in once, in a small window. OpenAI sends that window back to an
// address on 127.0.0.1, which the worker watches for, so nothing has to listen
// there. The tokens stay in the extension's own database, which pages and the
// script Spine adds to them can't open, and only ever go to OpenAI.

const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const RESOURCE = 'https://api.openai.com/v1';
const DYNAMIC_CLIENT = 'dynamic_agent_client';
const NAME = 'Spine';

// OpenAI's addresses; the tests point them at a stand-in.
async function where() {
  const real = { issuer: 'https://auth.openai.com', api: 'https://api.openai.com/v1' };
  if (!SPINE_TEST) return real;
  const { chatgptTest } = await chrome.storage.local.get('chatgptTest');
  return { ...real, ...chatgptTest };
}

const failure = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });

/* The sign-in, kept in the extension's IndexedDB */

let db = null;
function vault() {
  db ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('spine', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('secrets');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return db;
}
async function load() {
  const store = (await vault()).transaction('secrets').objectStore('secrets');
  return new Promise((resolve, reject) => {
    const get = store.get('chatgpt');
    get.onsuccess = () => resolve(get.result ?? {});
    get.onerror = () => reject(get.error);
  });
}
async function save(record) {
  const done = (await vault()).transaction('secrets', 'readwrite');
  done.objectStore('secrets').put(record, 'chatgpt');
  return new Promise((resolve, reject) => {
    done.oncomplete = () => resolve(record);
    done.onerror = () => reject(done.error);
  });
}
// Signing out keeps this browser's host id and the client OpenAI issued, so
// signing in again doesn't register Spine a second time.
async function forget() {
  const { hostId, clientId, email } = await load();
  await save({ hostId, clientId, email });
}

export async function status() {
  const record = await load();
  return { signedIn: Boolean(record.refreshToken), email: record.email ?? '', name: record.name ?? '' };
}

/* Signing in */

const base64url = bytes =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const challenge = async verifier =>
  base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

let pending = null;

// Opens OpenAI's sign-in in a small window over from, the tab or page that
// asked. The outcome arrives later as a 'spine:connected' message.
export async function signIn(from) {
  if (pending) finish(pending, { error: failure('restarted', 'Signing in started again.') });
  const { issuer } = await where();
  const record = await load();
  // One stable id for this browser, chosen before its first sign-in.
  if (!record.hostId) await save({ ...record, hostId: `urn:uuid:${crypto.randomUUID()}` });
  const { hostId, clientId = DYNAMIC_CLIENT, idToken, email } = await load();
  // Only the port may change between sign-ins; a random one is unlikely to
  // belong to anything else on this computer.
  const redirect = `http://127.0.0.1:${20000 + Math.floor(Math.random() * 40000)}/auth/callback`;
  const attempt = { state: random(), nonce: random(), verifier: random(), redirect, clientId, from };
  const url = new URL(`${issuer}/api/accounts/authorize`);
  const params = {
    client_id: clientId,
    ...(clientId === DYNAMIC_CLIENT && { agent_name_hint: NAME }),
    ext_agent_host_id: hostId,
    ...(idToken && { id_token_hint: idToken }),
    ...(email && { login_hint: email }),
    response_type: 'code',
    redirect_uri: redirect,
    scope: SCOPE,
    resource: RESOURCE,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: 'S256',
    code_challenge: await challenge(attempt.verifier),
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  pending = attempt;
  chrome.tabs.onUpdated.addListener(watch);
  chrome.tabs.onRemoved.addListener(closed);
  // Calling the extension's APIs keeps the worker awake while the reader signs in.
  attempt.awake = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  attempt.timer = setTimeout(() => finish(attempt, { error: failure('timeout', 'Signing in took too long. Try again.') }), 10 * 60 * 1000);
  try {
    const window = await open(url.href, from?.windowId);
    attempt.windowId = window.id;
    attempt.tabId = window.tabs?.[0]?.id;
  } catch {
    finish(attempt, { error: failure('window', 'Spine couldn’t open the ChatGPT sign-in.') });
  }
}

// A sign-in window centred over the reader's, or a plain one, or a tab.
async function open(url, near) {
  const size = { width: 500, height: 720 };
  let place = {};
  try {
    const parent = near ? await chrome.windows.get(near) : await chrome.windows.getLastFocused();
    place = {
      left: Math.max(0, Math.round(parent.left + (parent.width - size.width) / 2)),
      top: Math.max(0, Math.round(parent.top + Math.min(90, (parent.height - size.height) / 2))),
    };
  } catch {}
  for (const options of [{ type: 'popup', ...size, ...place }, { type: 'popup', ...size }, {}]) {
    try {
      return await chrome.windows.create({ url, focused: true, ...options });
    } catch {}
  }
  const tab = await chrome.tabs.create({ url });
  return { id: tab.windowId, tabs: [tab] };
}

function watch(tabId, change, tab) {
  const attempt = pending;
  const url = change.url ?? tab?.url ?? '';
  if (attempt && url.startsWith(attempt.redirect)) finish(attempt, { url, tabId });
}
function closed(tabId) {
  const attempt = pending;
  if (attempt && tabId === attempt.tabId) finish(attempt, { error: failure('closed', 'The ChatGPT window closed before you signed in.') });
}

async function finish(attempt, { url, tabId, error }) {
  if (pending !== attempt) return;
  pending = null;
  clearInterval(attempt.awake);
  clearTimeout(attempt.timer);
  chrome.tabs.onUpdated.removeListener(watch);
  chrome.tabs.onRemoved.removeListener(closed);
  if (url) chrome.tabs.remove(tabId).catch(() => {});
  let outcome;
  try {
    if (error) throw error;
    await complete(attempt, new URL(url));
    // Signing in is choosing ChatGPT to read.
    await chrome.storage.local.set({ engine: 'chatgpt' });
    outcome = { ok: true };
  } catch (problem) {
    if (problem.code !== 'restarted') console.warn('Spine ChatGPT sign-in', problem);
    outcome = { ok: false, code: problem.code ?? 'failed', message: problem.message };
  }
  if (outcome.code === 'restarted') return;
  // Back to where the reader started, which picks up from here.
  const message = { type: 'spine:connected', engine: 'chatgpt', ...outcome };
  const from = attempt.from;
  if (from?.tabId) {
    await chrome.windows.update(from.windowId, { focused: true }).catch(() => {});
    await chrome.tabs.update(from.tabId, { active: true }).catch(() => {});
    chrome.tabs.sendMessage(from.tabId, message).catch(() => {});
  }
  chrome.runtime.sendMessage(message).catch(() => {});
}

// The callback: check it belongs to this attempt, swap the code for tokens,
// and keep them.
async function complete(attempt, url) {
  const params = url.searchParams;
  if (params.get('state') !== attempt.state) throw failure('state', 'That sign-in didn’t match. Try again.');
  const refused = params.get('error');
  if (refused === 'access_denied') throw failure('denied', 'You didn’t allow Spine to use your ChatGPT plan.');
  if (refused) throw failure('failed', `ChatGPT sign-in failed: ${params.get('error_description') || refused}`);
  // A first sign-in registers Spine and returns the client id OpenAI issued.
  let clientId = attempt.clientId;
  if (clientId === DYNAMIC_CLIENT) {
    clientId = params.get('client_id');
    if (!clientId || clientId === DYNAMIC_CLIENT) throw failure('failed', 'ChatGPT didn’t finish setting Spine up. Try again.');
  }
  const tokens = await post({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: params.get('code') ?? '',
    code_verifier: attempt.verifier,
    redirect_uri: attempt.redirect,
  });
  const { issuer } = await where();
  const claims = identity(tokens.id_token, { issuer, clientId, nonce: attempt.nonce });
  if (!String(tokens.scope ?? '').split(' ').includes(PLAN_SCOPE)) {
    throw failure('plan', 'ChatGPT didn’t allow Spine to use your plan.');
  }
  await save({
    ...(await load()),
    clientId,
    subject: claims.sub,
    email: claims.email ?? '',
    name: claims.name ?? '',
    idToken: tokens.id_token,
    ...session(tokens),
    models: null,
  });
}

// The ID token comes straight from OpenAI's token endpoint over TLS, so its
// signature can go unchecked (OpenID Connect Core 3.1.3.7), but it must be for
// this client and this sign-in.
function identity(idToken, { issuer, clientId, nonce }) {
  let claims;
  try {
    const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), c => c.charCodeAt(0))));
  } catch {
    throw failure('failed', 'ChatGPT sign-in returned something Spine couldn’t read. Try again.');
  }
  const audience = [].concat(claims.aud);
  if (claims.iss !== issuer || !audience.includes(clientId) || claims.nonce !== nonce) {
    throw failure('failed', 'ChatGPT sign-in returned someone else’s answer. Try again.');
  }
  return claims;
}

const session = tokens => ({
  accessToken: tokens.access_token,
  refreshToken: tokens.refresh_token,
  expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  scopes: tokens.scope ?? '',
});

async function post(body) {
  const { issuer } = await where();
  const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, resource: RESOURCE }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw failure(data.error ?? 'failed', `ChatGPT sign-in failed: ${data.error_description || data.error || response.status}`, {
      status: response.status,
    });
  }
  return data;
}

// An access token with at least five minutes left, renewed when it hasn't.
// One renewal at a time: each one replaces the refresh token.
let renewing = null;
async function token({ force = false } = {}) {
  const record = await load();
  if (!record.refreshToken) return null;
  if (!force && record.accessToken && record.expiresAt - Date.now() > 5 * 60 * 1000) return record.accessToken;
  renewing ??= (async () => {
    try {
      const tokens = await post({ grant_type: 'refresh_token', client_id: record.clientId, refresh_token: record.refreshToken });
      const next = { ...(await load()), ...session(tokens) };
      next.refreshToken = tokens.refresh_token ?? record.refreshToken;
      await save(next);
      return next.accessToken;
    } catch (error) {
      // Turned down means the reader signed out of Spine in ChatGPT, or the
      // session ran out: they sign in again.
      if (error.status === 400 || error.status === 401) {
        await forget();
        return null;
      }
      throw error;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

export async function signOut() {
  const record = await load();
  if (record.refreshToken) {
    try {
      const { issuer } = await where();
      const config = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();
      await fetch(config.revocation_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: record.refreshToken, token_type_hint: 'refresh_token', client_id: record.clientId }),
      });
    } catch (error) {
      console.warn('Spine couldn’t confirm signing out of ChatGPT', error);
    }
  }
  await forget();
}

/* Models and reading */

// The models the reader's plan offers, in OpenAI's order, checked once a day.
export async function models({ fresh = false } = {}) {
  const record = await load();
  if (!fresh && record.models?.length && Date.now() - record.modelsAt < 24 * 60 * 60 * 1000) return record.models;
  const access = await token();
  if (!access) return [];
  const { api } = await where();
  const response = await fetch(`${api}/models`, { headers: { Authorization: `Bearer ${access}` } });
  if (!response.ok) return record.models ?? [];
  const data = await response.json();
  const list = (data.models ?? [])
    .filter(model => model.visibility === 'list' && model.slug)
    .map(model => ({ slug: model.slug, name: model.display_name || model.slug }));
  await save({ ...(await load()), models: list, modelsAt: Date.now() });
  return list;
}

// One read on the reader's plan: the reply streams back as 'delta' messages,
// then 'done' or 'error', like a read through the API.
export async function read(port, signal, { request, system, user, schema, effort, model: wanted }) {
  const relay = message => {
    try {
      port.postMessage(message);
    } catch {}
  };
  try {
    let access = await token();
    if (!access) return relay({ type: 'error', ...explain(401) });
    const list = await models();
    const model = list.find(entry => entry.slug === wanted) ?? list[0];
    if (!model) return relay({ type: 'error', code: 'chatgpt', message: 'ChatGPT offered no model for your plan. Try again later.' });
    const { api } = await where();
    const body = JSON.stringify({
      model: model.slug,
      instructions: system,
      input: [{ role: 'user', content: user }],
      text: { format: { type: 'json_schema', name: request, schema, strict: true } },
      reasoning: { effort },
      store: false,
      stream: true,
    });
    let response;
    for (let tries = 0; tries < 2; tries++) {
      response = await fetch(`${api}/responses`, {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body,
      });
      // An access token can stop working before it expires; renew it once.
      if (response.status !== 401 || tries) break;
      access = await token({ force: true });
      if (!access) break;
    }
    if (!response.ok) return relay({ type: 'error', ...explain(response.status, await response.json().catch(() => null)) });

    let text = '';
    let waiting = '';
    let timer = null;
    const flush = () => {
      timer = null;
      if (waiting) relay({ type: 'delta', text: waiting });
      waiting = '';
    };
    for await (const event of events(response.body)) {
      if (event.type === 'response.output_text.delta') {
        text += event.delta;
        waiting += event.delta;
        timer ??= setTimeout(flush, 60);
      } else if (event.type === 'response.refusal.done') {
        clearTimeout(timer);
        return relay({ type: 'error', code: 'refusal', message: 'ChatGPT declined to read this article.' });
      } else if (event.type === 'response.completed') {
        clearTimeout(timer);
        flush();
        return relay({ type: 'done', text, model: model.name, usage: event.response?.usage, billing: 'plan' });
      } else if (event.type === 'response.incomplete') {
        clearTimeout(timer);
        return relay({ type: 'error', code: 'too-long', message: 'This article is too long to read in one go.' });
      } else if (event.type === 'response.failed' || event.type === 'error') {
        clearTimeout(timer);
        return relay({ type: 'error', ...explain(null, { error: event.response?.error ?? event.error ?? event }) });
      }
    }
    clearTimeout(timer);
    if (!signal.aborted) relay({ type: 'error', code: 'chatgpt', message: 'ChatGPT stopped before it finished. Try again.' });
  } catch (error) {
    if (signal.aborted) return;
    console.warn('Spine ChatGPT request failed', error);
    relay({ type: 'error', code: 'network', message: 'ChatGPT couldn’t be reached. Check your connection and try again.' });
  }
}

// The events in a Responses API stream.
async function* events(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end;
    while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
      const data = chunk
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {}
    }
  }
}

// A failure the reader can act on, in OpenAI's words where they have them.
function explain(status, data) {
  const error = data?.error ?? {};
  const code = String(error.code ?? error.type ?? data?.detail ?? '');
  if (/usage_limit_exceeded|usage_unavailable/.test(code) || status === 429) {
    return { code: 'limit', message: 'Usage limit reached. Review your plan or Spine’s limit in ChatGPT settings.' };
  }
  if (/user_not_eligible/.test(code)) {
    return { code: 'chatgpt-plan', message: 'Your ChatGPT plan can’t be used in other apps. ChatGPT Plus and Pro can.' };
  }
  if (/invalid_user/.test(code) || status === 401) {
    return { code: 'chatgpt-signin', message: 'Sign in to ChatGPT again to keep reading.' };
  }
  if (/unsupported_capability/.test(code)) {
    return { code: 'request', message: `ChatGPT couldn’t take this request${error.param ? ` (${error.param})` : ''}.` };
  }
  if (status === 503) return { code: 'network', message: 'ChatGPT is busy right now. Try again in a minute.' };
  return { code: 'chatgpt', message: `ChatGPT ran into a problem${status ? ` (${status})` : ''}. Try again in a moment.` };
}
