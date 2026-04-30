# Remove Unused Apartment Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove pearls, Plan B, and extra budget thresholds so `Loyer max (CHF)` is the only maximum-rent control.

**Architecture:** Extract the scraper's listing classification decisions into a small importable helper module, cover it with focused `node:test` tests, then wire the scraper to that helper. Remove the unused controls and filters from the vanilla dashboard and stop persisting stale config fields from the server API.

**Tech Stack:** Node.js 18+ ESM, `node:test`, vanilla HTML/CSS/JS, native HTTP server.

---

### Task 1: Add Filtering Regression Tests

**Files:**
- Create: `tests/listing-filters.test.mjs`
- Create: `scripts/listing-filters.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/listing-filters.test.mjs`:

```js
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
      pearl: { enabled: true, minRooms: 2, minSurfaceM2: 50, keywords: ['balcon'], minHits: 1 }
    }
  };

  assert.equal(isBudgetEligible({ totalChf: 1450, rooms: 3, surfaceM2: 70, title: 'Balcon' }, config), false);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/listing-filters.test.mjs`

Expected: FAIL with module-not-found for `scripts/listing-filters.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/listing-filters.mjs`:

```js
function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isBudgetEligible(item, config) {
  const maxBudget = Number(config.filters?.maxTotalChf ?? 1400);
  return item.totalChf != null && Number(item.totalChf) <= maxBudget;
}

export function derivePriority(item, config) {
  const listingStage = String(item?.listingStage || '').toLowerCase();
  if (listingStage === 'off_market') return 'A';
  if (listingStage === 'early_market') return 'A-';

  const budget = Number(config.filters?.maxTotalChf ?? 1400);
  const minRooms = Number(config.filters?.minRoomsPreferred ?? 2);
  const rooms = Number(item.rooms ?? 0);
  const total = Number(item.totalChf ?? 999999);

  if (total <= budget && rooms >= minRooms) return 'A';
  return 'B';
}

export function isSizeEligible(item, config) {
  const minRooms = Number(config.filters?.minRoomsPreferred ?? 2);
  const minSurface = Number(config.filters?.minSurfaceM2Preferred ?? 0);
  const allowMissingSurface = config.filters?.allowMissingSurface !== false;

  const rooms = toPositiveNumber(item.rooms);
  if (rooms == null || rooms < minRooms) return false;

  if (!Number.isFinite(minSurface) || minSurface <= 0) return true;

  const surface = toPositiveNumber(item.surfaceM2);
  if (surface == null) return allowMissingSurface;
  return surface >= minSurface;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/listing-filters.test.mjs`

Expected: PASS.

### Task 2: Wire Scraper To Simplified Filtering

**Files:**
- Modify: `scripts/scrape-immobilier.mjs`
- Modify: `scripts/listing-filters.mjs`
- Test: `tests/listing-filters.test.mjs`

- [ ] **Step 1: Import helpers**

Add to `scripts/scrape-immobilier.mjs` imports:

```js
import {
  derivePriority,
  isBudgetEligible,
  isSizeEligible
} from './listing-filters.mjs';
```

- [ ] **Step 2: Remove local helper implementations**

Delete local `derivePriority`, `isSizeEligible`, and `isPearl` from `scripts/scrape-immobilier.mjs`.

- [ ] **Step 3: Replace hard/pearl display logic**

In both active and stale-listing refresh paths, remove `isPearl` and `withinHardBudget` calculations. Use `budgetEligible: isBudgetEligible(item, config)` and require `budgetEligible` in `display`.

- [ ] **Step 4: Update filter reason**

When budget eligibility fails, use:

```js
item.filterReason = `Au-dessus de CHF ${Number(config.filters?.maxTotalChf ?? 1400)}`;
```

- [ ] **Step 5: Run regression test**

Run: `node --test tests/listing-filters.test.mjs`

Expected: PASS.

### Task 3: Remove UI And API Controls

**Files:**
- Modify: `dashboard/home.html`
- Modify: `dashboard/home.js`
- Modify: `dashboard/home.css`
- Modify: `dashboard/index.html`
- Modify: `dashboard/app.js`
- Modify: `scripts/serve-dashboard.mjs`

- [ ] **Step 1: Remove profile form fields**

Delete the hard threshold, pearl threshold, pearl fieldset, and Plan B checkbox from `dashboard/home.html`.

- [ ] **Step 2: Remove form JavaScript references**

Delete `pearlEnabledEl`, `pearlOptionsEl`, the pearl toggle listener, hard/pearl field reads/writes, `allowStudioTransition`, and `pearl` from `dashboard/home.js`.

- [ ] **Step 3: Remove unused CSS**

Delete `.pearl-fieldset`, `.pearl-fieldset legend`, `.pearl-options`, and `.pearl-options.hidden` from `dashboard/home.css`.

- [ ] **Step 4: Remove dashboard filters and cards**

Delete `transition` and `pearl` options from `dashboard/index.html`. Delete `pearl` and `transition` handling and the `Perles` card from `dashboard/app.js`. Relabel `Priorité A / A★` to `Priorité A`.

- [ ] **Step 5: Stop writing removed API config fields**

Remove `maxTotalHardChf`, `maxPearlTotalChf`, `allowStudioTransition`, and `pearl` from default config and `buildConfigFromPayload()` in `scripts/serve-dashboard.mjs`.

### Task 4: Update Documentation And Verify

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Remove stale docs**

Delete current references to pearl detection, hard/pearl thresholds, and Plan B. Document that priority A is within budget and matching criteria, while B is low-priority/non-matching.

- [ ] **Step 2: Run all local tests**

Run: `node --test tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 3: Check for stale terms**

Run: `rg -n "perle|pearl|plan B|plans B|seuil dur|seuil perle|maxTotalHard|maxPearl|allowStudioTransition|A★|Priority B|Priorité B" dashboard scripts tests README.md AGENTS.md`

Expected: no matches for active removed features, except historical docs in `docs/superpowers`.
