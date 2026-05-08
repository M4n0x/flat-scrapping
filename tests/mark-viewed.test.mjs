import assert from 'node:assert/strict';
import test from 'node:test';

import { applyViewedAt } from '../scripts/mark-viewed.mjs';

test('applyViewedAt sets viewedAt on every matching id', () => {
  const tracker = {
    schemaVersion: 2,
    listings: [
      { id: 'a' },
      { id: 'b', viewedAt: '2026-04-20T08:00:00.000Z' },
      { id: 'c' }
    ]
  };
  const now = '2026-04-30T12:00:00.000Z';

  const { tracker: next, updated } = applyViewedAt(tracker, ['a', 'c'], now);

  assert.equal(updated, 2);
  assert.equal(next.listings.find((l) => l.id === 'a').viewedAt, now);
  assert.equal(next.listings.find((l) => l.id === 'c').viewedAt, now);
  assert.equal(next.listings.find((l) => l.id === 'b').viewedAt, '2026-04-20T08:00:00.000Z');
});

test('applyViewedAt overwrites an existing viewedAt for ids that are passed in', () => {
  const tracker = {
    listings: [{ id: 'a', viewedAt: '2026-04-01T00:00:00.000Z' }]
  };
  const now = '2026-04-30T12:00:00.000Z';

  const { tracker: next, updated } = applyViewedAt(tracker, ['a'], now);

  assert.equal(updated, 1);
  assert.equal(next.listings[0].viewedAt, now);
});

test('applyViewedAt ignores unknown ids and reports updated count accurately', () => {
  const tracker = { listings: [{ id: 'a' }] };
  const { updated } = applyViewedAt(tracker, ['ghost', 'a'], '2026-04-30T12:00:00.000Z');
  assert.equal(updated, 1);
});

test('applyViewedAt with empty ids returns the tracker unchanged', () => {
  const tracker = { listings: [{ id: 'a' }] };
  const { tracker: next, updated } = applyViewedAt(tracker, [], 'now');
  assert.equal(updated, 0);
  assert.equal(next.listings[0].viewedAt, undefined);
});

test('applyViewedAt rejects non-array ids gracefully', () => {
  const tracker = { listings: [{ id: 'a' }] };
  const { updated } = applyViewedAt(tracker, null, 'now');
  assert.equal(updated, 0);
});
