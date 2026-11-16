// Fetches an article's page for Spine for iPhone, which, as a web page, can't
// fetch other sites itself. Only the owner's key may ask, and only for web
// pages on the public internet.
//
//   GET /api/fetch?url=…   { url, html }: the page, and where it ended up
import { authorized } from './key.js';

const LARGEST = 6 * 1024 * 1024;
const PATIENCE = 20_000;
// Pages answer a phone's browser with the page a phone would see.
const AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization',
  'access-control-max-age': '86400',
};
const json = (body, status = 200) => Response.json(body, { status, headers: { ...CORS, 'cache-control': 'no-store' } });

// Addresses inside a network rather than on the internet.
function inside(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127|10|0)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    host === '::1' ||
    host === '::' ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host)
  );
}

// The page's text in its own character set, up to LARGEST.
async function textOf(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LARGEST) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  const declared = (response.headers.get('content-type') ?? '').match(/charset=([\w-]+)/i)?.[1];
  const meta = bytes.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(declared || meta || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// local lets the tests fetch pages on this computer.
export async function fetchPage(request, { key, local = false }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json({ error: 'Spine’s server doesn’t do that.' }, 405);
  if (!authorized(request, key)) return json({ error: 'Spine’s server didn’t accept the key. Connect Spine again from your Mac.' }, 401);
  let target;
  try {
    target = new URL(new URL(request.url).searchParams.get('url') ?? '');
  } catch {
    return json({ error: 'That isn’t a web address.' }, 400);
  }
  if (!/^https?:$/.test(target.protocol)) return json({ error: 'Spine opens web pages only.' }, 400);
  if (!local && inside(target.hostname)) return json({ error: 'Spine can’t open addresses inside a private network.' }, 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PATIENCE);
  try {
    let response;
    try {
      response = await fetch(target, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-GB,en;q=0.9',
        },
      });
    } catch {
      return json({ error: controller.signal.aborted ? 'That page took too long to answer.' : 'That page didn’t answer.' }, 502);
    }
    if (!local && inside(new URL(response.url).hostname)) return json({ error: 'Spine can’t open addresses inside a private network.' }, 400);
    if (!response.ok) {
      const why = response.status === 404 ? 'There’s no page at that address.' : response.status === 403 || response.status === 401 ? 'That site didn’t let Spine in.' : `That site answered with an error (${response.status}).`;
      return json({ error: why, status: response.status }, 502);
    }
    if (!/html|xml/i.test(response.headers.get('content-type') ?? 'text/html')) return json({ error: 'That link isn’t a web page.' }, 415);
    const html = await textOf(response).catch(() => null);
    if (html === null) return json({ error: 'That page is too big for Spine.' }, 413);
    return json({ url: response.url || target.href, html });
  } finally {
    clearTimeout(timer);
  }
}
