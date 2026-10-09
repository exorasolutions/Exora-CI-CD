import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliveryDedupe } from './delivery-dedupe.js';

test('detects duplicate delivery within ttl', () => {
  const d = new DeliveryDedupe(100);
  assert.equal(d.hasOrAdd('abc', 1000), false);
  assert.equal(d.hasOrAdd('abc', 1050), true);
  assert.equal(d.hasOrAdd('abc', 1101), false);
});
