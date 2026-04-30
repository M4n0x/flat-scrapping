import assert from 'node:assert/strict';
import test from 'node:test';

import {
  derivePriority,
  isBudgetEligible,
  isSizeEligible
} from '../scripts/listing-filters.mjs';

test('budget eligibility uses maxTotalChf as the only upper rent ceiling', () => {
  const config = {
    filters: {
      maxTotalChf: 1400,
      maxTotalHardChf: 1550,
      maxPearlTotalChf: 1700,
      pearl: {
        enabled: true,
        minRooms: 2,
        minSurfaceM2: 50,
        keywords: ['balcon'],
        minHits: 1
      }
    }
  };

  assert.equal(
    isBudgetEligible({ totalChf: 1450, rooms: 3, surfaceM2: 70, title: 'Balcon' }, config),
    false
  );
  assert.equal(isBudgetEligible({ totalChf: 1400 }, config), true);
});

test('size eligibility ignores stale Plan B settings', () => {
  const config = {
    filters: {
      minRoomsPreferred: 2,
      minSurfaceM2Preferred: 0,
      allowStudioTransition: true
    }
  };

  assert.equal(isSizeEligible({ rooms: 1.5, objectType: 'Studio' }, config), false);
  assert.equal(isSizeEligible({ rooms: 2, objectType: 'Appartement' }, config), true);
});

test('priority classification no longer emits pearl priority', () => {
  const config = {
    filters: {
      maxTotalChf: 1400,
      maxTotalHardChf: 1550,
      maxPearlTotalChf: 1700,
      minRoomsPreferred: 2
    }
  };

  assert.equal(derivePriority({ totalChf: 1450, rooms: 3, title: 'Balcon' }, config), 'B');
});
