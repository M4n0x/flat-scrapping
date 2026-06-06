import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFilters, defaultFilterState } from '../dashboard/filter-logic.js';

const NOW = new Date('2026-04-30T12:00:00.000Z').getTime();

const fixture = [
  { id: 'a', profileSlug: 'p1', status: 'sorting',  priority: 'A',  source: 'flatfox.ch',     firstSeenAt: '2026-04-29T12:00:00.000Z', viewedAt: null },
  { id: 'b', profileSlug: 'p1', status: 'pursuing', priority: 'A-', source: 'flatfox.ch',     firstSeenAt: '2026-04-15T00:00:00.000Z', viewedAt: '2026-04-25T08:00:00.000Z' },
  { id: 'c', profileSlug: 'p2', status: 'archived', priority: 'B',  source: 'naef.ch',        firstSeenAt: '2026-03-10T00:00:00.000Z', viewedAt: null },
  { id: 'd', profileSlug: 'p2', status: 'sorting',  priority: 'A',  source: 'immobilier.ch',  firstSeenAt: '2026-04-28T00:00:00.000Z', viewedAt: null }
];

test('default state shows sorting+pursuing items, hides archived; all profiles, priorities, sources', () => {
  const state = defaultFilterState();
  const visible = applyFilters(fixture, state, NOW);
  assert.deepEqual(visible.map((l) => l.id), ['a', 'b', 'd']);
});

test('hidden profile drops its rows', () => {
  const state = { ...defaultFilterState(), hiddenProfiles: new Set(['p2']) };
  const visible = applyFilters(fixture, state, NOW);
  assert.deepEqual(visible.map((l) => l.id), ['a', 'b']);
});

test('recent filter (last 3 days) keeps only firstSeenAt within window', () => {
  const state = { ...defaultFilterState(), recent: '3d' };
  const visible = applyFilters(fixture, state, NOW);
  assert.deepEqual(visible.map((l) => l.id), ['a', 'd']);
});

test('unread-only drops listings with viewedAt set', () => {
  const state = { ...defaultFilterState(), unreadOnly: true };
  const visible = applyFilters(fixture, state, NOW);
  assert.deepEqual(visible.map((l) => l.id), ['a', 'd']);
});

test('status checkbox set narrows by status', () => {
  const state = { ...defaultFilterState(), statuses: new Set(['archived']) };
  const visible = applyFilters(fixture, state, NOW);
  assert.deepEqual(visible.map((l) => l.id), ['c']);
});

test('priority filter narrows by priority', () => {
  const state = { ...defaultFilterState(), priorities: new Set(['A']) };
  const visible = applyFilters(fixture, state, NOW);
  assert.deepEqual(visible.map((l) => l.id), ['a', 'd']);
});

test('source filter narrows by source', () => {
  const state = { ...defaultFilterState(), sources: new Set(['flatfox.ch']) };
  const visible = applyFilters(fixture, state, NOW);
  assert.deepEqual(visible.map((l) => l.id), ['a', 'b']);
});

test('filters compose (recent and unread and priority A)', () => {
  const state = {
    ...defaultFilterState(),
    recent: '3d',
    unreadOnly: true,
    priorities: new Set(['A'])
  };
  const visible = applyFilters(fixture, state, NOW);
  assert.deepEqual(visible.map((l) => l.id), ['a', 'd']);
});
