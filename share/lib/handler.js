// Spine's share server. It keeps shared articles and shows each one at a short
// address, in Spine's reader. Only the owner's key can make, change or delete a
// link; anyone with a link can read it.
//
//   POST   /api/share         a new link, for the share in the body
//   PUT    /api/share?id=…    the same link, showing a new share
//   DELETE /api/share?id=…    the link, gone
//   GET    /api/share         whether a key works
//   GET    /api/share?id=…    whether a link is still there
//   GET    /<id>              the shared article, as a page
//
// store keeps the shares: get, create (never over another), put and delete.
import { randomInt, timingSafeEqual } from 'node:crypto';
import { missing, page } from './page.js';

// Ids leave out characters that look alike, so a link copied by hand still works.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const ID = /^[A-Za-z0-9]{8}$/;
const LARGEST = 4 * 1024 * 1024;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};
// A page runs Spine's reader and nothing else: no script but its own, no
// requests but for its font, and article images from anywhere.
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    'img-src https: http: data:',
    'media-src https: http:',
    "font-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

const json = (body, status = 200) => Response.json(body, { status, headers: { ...CORS, 'cache-control': 'no-store' } });
const newId = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

function authorized(request, key) {
  const given = Buffer.from((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const wanted = Buffer.from(key ?? '');
  return wanted.length >= 16 && given.length === wanted.length && timingSafeEqual(given, wanted);
}

// What a share must hold for a page to show it. The page checks every block
// again as it builds the article.
function valid(share) {
  const article = share?.article;
  return (
    share?.v === 1 &&
    typeof share.fingerprint === 'string' &&
    typeof article?.meta?.title === 'string' &&
    typeof article.meta.url === 'string' &&
    Array.isArray(article.blocks) &&
    article.blocks.length > 0 &&
    article.blocks.every(block => typeof block === 'string')
  );
}

async function read(request) {
  if (Number(request.headers.get('content-length') ?? 0) > LARGEST) return { tooBig: true };
  const text = await request.text();
  if (text.length > LARGEST) return { tooBig: true };
  try {
    return { share: JSON.parse(text) };
  } catch {
    return {};
  }
}

async function showPage(id, store, origin) {
  const share = ID.test(id) ? await store.get(id) : null;
  // Shares change and go, so pages are kept for a minute at most.
  const cache = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60';
  if (!share) return new Response(missing(), { status: 404, headers: { ...PAGE_HEADERS, 'cache-control': cache } });
  return new Response(page(share, { url: `${origin}/${id}` }), { headers: { ...PAGE_HEADERS, 'cache-control': cache } });
}

export async function handle(request, { store, key, origin = null }) {
  const url = new URL(request.url);
  const base = origin ?? url.origin;
  const pageId = url.searchParams.get('page') ?? url.pathname.match(/^\/([A-Za-z0-9]{8})$/)?.[1] ?? null;
  if (pageId !== null) return showPage(pageId, store, base);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!authorized(request, key)) return json({ error: 'The share server didn’t accept that key.' }, 401);

  const id = url.searchParams.get('id');
  const needsId = request.method === 'PUT' || request.method === 'DELETE';
  if (needsId && !id) return json({ error: 'Say which link.' }, 400);
  if (id !== null && !ID.test(id)) return json({ error: 'There’s no link with that id.' }, 404);
  switch (request.method) {
    case 'GET':
      if (id !== null && !(await store.get(id))) return json({ error: 'There’s no link with that id.' }, 404);
      return json({ ok: true });
    case 'POST':
    case 'PUT': {
      const { share, tooBig } = await read(request);
      if (tooBig) return json({ error: 'This article is too big to share.' }, 413);
      if (!valid(share)) return json({ error: 'That isn’t a share Spine can show.' }, 400);
      const now = Date.now();
      if (request.method === 'POST') {
        const fresh = newId();
        await store.create(fresh, { ...share, id: fresh, created: now, updated: now });
        return json({ id: fresh, url: `${base}/${fresh}` }, 201);
      }
      const before = await store.get(id);
      if (!before) return json({ error: 'There’s no link with that id.' }, 404);
      await store.put(id, { ...share, id, created: before.created ?? now, updated: now });
      return json({ id, url: `${base}/${id}` });
    }
    case 'DELETE': {
      if (!(await store.get(id))) return json({ error: 'There’s no link with that id.' }, 404);
      await store.delete(id);
      return json({ ok: true });
    }
    default:
      return json({ error: 'The share server doesn’t do that.' }, 405);
  }
}
