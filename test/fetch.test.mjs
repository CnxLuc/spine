// The share server fetches an article's page for Spine for iPhone: only for
// the owner's key, only web pages on the internet, and it says where the page
// ended up after redirects.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { fetchPage } from '../share/lib/fetch.js';

const key = 'a-key-long-enough-for-tests';
const ask = (url, { local = false, given = key } = {}) =>
  fetchPage(new Request(`https://spine.test/api/fetch?url=${encodeURIComponent(url)}`, { headers: { authorization: `Bearer ${given}` } }), {
    key,
    local,
  });

test('only the owner’s key may ask', async () => {
  const response = await ask('https://example.com/', { given: 'someone-elses-key-entirely' });
  assert.equal(response.status, 401);
});

test('only web pages on the internet', async () => {
  for (const url of ['file:///etc/passwd', 'not a link', 'http://127.0.0.1:8080/', 'http://localhost/', 'http://192.168.1.1/', 'http://10.0.0.8/', 'http://[::1]/', 'http://printer.local/']) {
    const response = await ask(url);
    assert.equal(response.status, 400, `${url} was let through`);
  }
});

test('a page comes back with where it ended up, and anything else says why not', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/moved') {
      response.writeHead(302, { location: '/essay' });
      return response.end();
    }
    if (request.url === '/essay') {
      response.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
      return response.end(Buffer.from('<html><body><p>Café society</p></body></html>', 'latin1'));
    }
    if (request.url === '/picture') {
      response.writeHead(200, { 'content-type': 'image/png' });
      return response.end('png');
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const found = await ask(`${origin}/moved`, { local: true });
    assert.equal(found.status, 200);
    const page = await found.json();
    assert.equal(page.url, `${origin}/essay`);
    assert.match(page.html, /Café society/);
    assert.equal((await ask(`${origin}/picture`, { local: true })).status, 415);
    const gone = await ask(`${origin}/nothing`, { local: true });
    assert.equal(gone.status, 502);
    assert.match((await gone.json()).error, /no page at that address/);
  } finally {
    server.close();
  }
});
