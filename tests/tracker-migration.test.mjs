import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateTracker, TRACKER_SCHEMA_VERSION } from '../scripts/tracker-migration.mjs';

test('TRACKER_SCHEMA_VERSION is 2', () => {
  assert.equal(TRACKER_SCHEMA_VERSION, 2);
});

test('migrateTracker maps legacy statuses, drops isRemoved, stamps schemaVersion', () => {
  const before = {
    listings: [
      { id: 'a', status: 'À contacter' },
      { id: 'b', status: 'Visite' },
      { id: 'c', status: 'Refusé' },
      { id: 'd', isRemoved: true, status: 'Dossier' },
      { id: 'e', isRemoved: true }
    ]
  };

  const { tracker, changed } = migrateTracker(before);

  assert.equal(changed, true);
  assert.equal(tracker.schemaVersion, 2);
  assert.deepEqual(tracker.listings.map((l) => ({ id: l.id, status: l.status })), [
    { id: 'a', status: 'sorting' },
    { id: 'b', status: 'pursuing' },
    { id: 'c', status: 'archived' },
    { id: 'd', status: 'archived' },
    { id: 'e', status: 'archived' }
  ]);
  for (const listing of tracker.listings) {
    assert.equal(Object.prototype.hasOwnProperty.call(listing, 'isRemoved'), false);
  }
});

test('migrateTracker is idempotent on a v2 tracker', () => {
  const before = {
    schemaVersion: 2,
    listings: [
      { id: 'a', status: 'sorting' },
      { id: 'b', status: 'pursuing' }
    ]
  };

  const { tracker, changed } = migrateTracker(before);

  assert.equal(changed, false);
  assert.deepEqual(tracker, before);
});

test('migrateTracker defaults unknown legacy statuses to sorting and reports changed', () => {
  const before = { listings: [{ id: 'a', status: 'Mystery' }] };
  const { tracker, changed } = migrateTracker(before);

  assert.equal(changed, true);
  assert.equal(tracker.listings[0].status, 'sorting');
});

test('migrateTracker drops the legacy statuses array on the tracker root', () => {
  const before = {
    listings: [],
    statuses: ['À contacter', 'Visite', 'Dossier', 'Relance', 'Accepté', 'Refusé', 'Sans réponse']
  };

  const { tracker, changed } = migrateTracker(before);

  assert.equal(changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(tracker, 'statuses'), false);
  assert.equal(tracker.schemaVersion, 2);
});

test('migrateTracker handles an empty tracker', () => {
  const { tracker, changed } = migrateTracker({});
  assert.equal(changed, true);
  assert.deepEqual(tracker, { schemaVersion: 2, listings: [] });
});

test('migrateTracker preserves unrelated fields on listings', () => {
  const before = {
    listings: [
      { id: 'a', status: 'Visite', notes: 'hello', score: 73, totalChf: 1450 }
    ]
  };
  const { tracker } = migrateTracker(before);
  assert.deepEqual(tracker.listings[0], {
    id: 'a',
    status: 'pursuing',
    notes: 'hello',
    score: 73,
    totalChf: 1450
  });
});

test('migrateTracker strips a stray statuses array even on a v2 input', () => {
  const before = {
    schemaVersion: 2,
    statuses: ['legacy', 'array', 'should not survive'],
    listings: [{ id: 'a', status: 'sorting' }]
  };

  const { tracker, changed } = migrateTracker(before);

  assert.equal(changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(tracker, 'statuses'), false);
  assert.equal(tracker.schemaVersion, 2);
  assert.equal(tracker.listings[0].status, 'sorting');
});

test('migrateTracker strips stray isRemoved on listings even on a v2 input', () => {
  const before = {
    schemaVersion: 2,
    listings: [
      { id: 'a', status: 'sorting', isRemoved: false },
      { id: 'b', status: 'pursuing', isRemoved: true }
    ]
  };

  const { tracker, changed } = migrateTracker(before);

  assert.equal(changed, true);
  for (const listing of tracker.listings) {
    assert.equal(Object.prototype.hasOwnProperty.call(listing, 'isRemoved'), false);
  }
  // isRemoved=true on a v2 listing is ambiguous: status was already 'pursuing' but
  // someone wrote isRemoved=true alongside it. Per the original migration semantics,
  // isRemoved=true wins and forces 'archived' — preserve that semantic on v2 too.
  assert.equal(tracker.listings.find((l) => l.id === 'b').status, 'archived');
  // The clean v2 entry stays put.
  assert.equal(tracker.listings.find((l) => l.id === 'a').status, 'sorting');
});

test('migrateTracker on a clean v2 input still returns changed: false (no work needed)', () => {
  const before = {
    schemaVersion: 2,
    listings: [{ id: 'a', status: 'sorting' }]
  };

  const { tracker, changed } = migrateTracker(before);

  assert.equal(changed, false);
  assert.equal(tracker, before);
});
