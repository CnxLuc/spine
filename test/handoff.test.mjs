// The sign-in a computer hands to Spine for iPhone survives the trip as text,
// and anything else pasted gets an answer that says what to do.
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeHandoff, encodeHandoff } from '../src/shared/handoff.js';

const chatgpt = {
  clientId: 'oaiapp_test',
  hostId: 'urn:uuid:4b0c',
  email: 'reader@example.com',
  name: 'Zoë Reader',
  accessToken: 'access.token.value',
  refreshToken: 'refresh-token',
  expiresAt: 1_800_000_000_000,
  scopes: 'chatgpt.tokens.use.direct',
};

test('a handoff comes back as it went', () => {
  const text = encodeHandoff({ server: 'https://read-with-spine.vercel.app', key: 'a-key-long-enough', chatgpt });
  assert.match(text, /^spine-iphone:[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeHandoff(text), { server: 'https://read-with-spine.vercel.app', key: 'a-key-long-enough', chatgpt });
});

test('a handoff pasted with words around it still reads', () => {
  const text = encodeHandoff({ server: '', key: '', chatgpt });
  assert.equal(decodeHandoff(`Here it is:\n${text}\n`).chatgpt.refreshToken, 'refresh-token');
});

test('anything else says what to do', () => {
  assert.throws(() => decodeHandoff('https://example.com'), /Copy for your iPhone/);
  assert.throws(() => decodeHandoff('spine-iphone:@@@'), /isn’t Spine’s sign-in/);
  assert.throws(() => decodeHandoff('spine-iphone:bm90IGpzb24'), /Copy it again/);
  const old = encodeHandoff({ server: '', key: '', chatgpt: { ...chatgpt, refreshToken: '' } });
  assert.throws(() => decodeHandoff(old), /another version/);
});
