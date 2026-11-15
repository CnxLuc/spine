// The share server on this computer, for the tests: the same handler as on
// Vercel (share/lib/handler.js), with shares kept in memory and the shared page
// from share/public. Build it first with `node share/build.mjs --test`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { handle } from '../share/lib/handler.js';

const PUBLIC = resolve('share/public');
const TYPES = { '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain' };

export async function startShareServer({ key = 'a-test-key-long-enough' } = {}) {
  const shares = new Map();
  // Stored as text, as Blob stores it, so nothing the tests hold changes a share.
  const store = {
    get: async id => (shares.has(id) ? JSON.parse(shares.get(id)) : null),
    create: async (id, share) => {
      if (shares.has(id)) throw new Error(`${id} is taken`);
      shares.set(id, JSON.stringify(share));
    },
    put: async (id, share) => void shares.set(id, JSON.stringify(share)),
    delete: async id => void shares.delete(id),
  };
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    try {
      if (url.pathname.startsWith('/reader/')) {
        const file = normalize(join(PUBLIC, url.pathname));
        if (!file.startsWith(PUBLIC)) throw Object.assign(new Error('outside'), { code: 'ENOENT' });
        const body = await readFile(file);
        outgoing.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        outgoing.end(body);
        return;
      }
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const headers = Object.fromEntries(
        ['authorization', 'content-type', 'content-length'].flatMap(name => (incoming.headers[name] ? [[name, incoming.headers[name]]] : [])),
      );
      const request = new Request(url, {
        method: incoming.method,
        headers,
        body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await handle(request, { store, key });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' });
      outgoing.end(error.code === 'ENOENT' ? 'Not found' : String(error.stack));
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, key, shares, close: () => new Promise(done => server.close(done)) };
}
