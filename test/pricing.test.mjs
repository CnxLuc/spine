import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, estimate, money } from '../src/shared/pricing.js';

test('costs a reply from its usage', () => {
  // 10,000 tokens in and 2,000 out on Opus 5.5: 4¢ + 4¢.
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 10000, output_tokens: 2000 }).toFixed(4), '0.0800');
  assert.equal(costOf('claude-sonnet-5-5', { input_tokens: 10000, output_tokens: 2000 }).toFixed(4), '0.0400');
  // A reply from a model Spine doesn't know is priced as the one it asked for.
  assert.equal(costOf('claude-unknown', { input_tokens: 1e6, output_tokens: 0 }, 'claude-haiku-4-5'), 1);
});

test('estimates match what real articles cost', () => {
  // Dario Amodei's essay: about 12,900 words, measured at about 66¢.
  const dario = estimate(12900, 'claude-opus-5-5');
  assert.ok(dario > 0.6 && dario < 0.75, `estimated ${dario}`);
  // A three-minute post, measured at about 5¢.
  const short = estimate(700, 'claude-opus-5-5');
  assert.ok(short > 0.04 && short < 0.07, `estimated ${short}`);
  // Sonnet costs about half, Haiku about a quarter.
  assert.ok(Math.abs(estimate(5000, 'claude-sonnet-5-5') / estimate(5000, 'claude-opus-5-5') - 0.5) < 0.01);
  assert.ok(Math.abs(estimate(5000, 'claude-haiku-4-5') / estimate(5000, 'claude-opus-5-5') - 0.25) < 0.01);
});

test('writes money the way people read it', () => {
  assert.equal(money(0.004), '1¢');
  assert.equal(money(0.4149), '41¢');
  assert.equal(money(0.996), '$1.00');
  assert.equal(money(1.4), '$1.40');
});
