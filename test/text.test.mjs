import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  breakAt,
  canonicalUrl,
  fingerprint,
  splitSentences,
  wordCount,
} from '../src/content/text.js';

const texts = text => splitSentences(text).map(sentence => sentence.text);

test('splits plain sentences and trims ranges', () => {
  const text = '  One sentence here. Another one!  A third?  ';
  const sentences = splitSentences(text);
  assert.deepEqual(
    sentences.map(s => s.text),
    ['One sentence here.', 'Another one!', 'A third?'],
  );
  for (const { start, end, text: body } of sentences) {
    assert.equal(text.slice(start, end), body);
  }
});

test('keeps initials, titles and Latin shorthands inside a sentence', () => {
  assert.deepEqual(texts('Iain M. Banks wrote it. Dr. Smith agreed.'), [
    'Iain M. Banks wrote it.',
    'Dr. Smith agreed.',
  ]);
  assert.deepEqual(texts('The U.S. Army moved. Then it rained.'), [
    'The U.S. Army moved.',
    'Then it rained.',
  ]);
  assert.deepEqual(texts('Use tools, e.g. Python, for this. Done.'), [
    'Use tools, e.g. Python, for this.',
    'Done.',
  ]);
});

test('joins a break before a lowercase word and inside a quotation', () => {
  assert.deepEqual(texts('It works (really!) most of the time. Yes.'), [
    'It works (really!) most of the time.',
    'Yes.',
  ]);
  assert.deepEqual(texts('He said “Stop. Now.” and left. Fine.'), [
    'He said “Stop. Now.” and left.',
    'Fine.',
  ]);
});

test('a list marker joins the sentence after it', () => {
  assert.deepEqual(texts('There are steps. 1. Do this first. 2. Then that.'), [
    'There are steps.',
    '1. Do this first.',
    '2. Then that.',
  ]);
});

test('breakAt splits a sentence at a bold lead-in', () => {
  const text = 'Maximize leverage: the basic development of AI is inevitable. More here.';
  const sentences = splitSentences(text);
  const at = 'Maximize leverage:'.length;
  const index = breakAt(sentences, text, at);
  assert.equal(index, 1);
  assert.deepEqual(
    sentences.map(s => s.text),
    ['Maximize leverage:', 'the basic development of AI is inevitable.', 'More here.'],
  );
  // A lead-in that already ends a sentence changes nothing.
  const other = 'Avoid grandiosity. I am often turned off by it.';
  const parts = splitSentences(other);
  assert.equal(breakAt(parts, other, 'Avoid grandiosity.'.length), 1);
  assert.equal(parts.length, 2);
});

test('counts words, including scripts without spaces', () => {
  assert.equal(wordCount(' one  two\nthree '), 3);
  assert.equal(wordCount(''), 0);
  assert.ok(wordCount('人工知能は世界を変える') >= 5);
});

test('fingerprints are stable and short', () => {
  assert.equal(fingerprint('abc'), fingerprint('abc'));
  assert.notEqual(fingerprint('abc'), fingerprint('abd'));
  assert.match(fingerprint('anything'), /^[0-9a-f]{8}$/);
});

test('canonical URLs drop fragments and tracking parameters', () => {
  assert.equal(
    canonicalUrl('https://example.com/post?utm_source=x&id=4&fbclid=y#section'),
    'https://example.com/post?id=4',
  );
  assert.equal(canonicalUrl('https://example.com/a?utm_medium=z'), 'https://example.com/a');
});
