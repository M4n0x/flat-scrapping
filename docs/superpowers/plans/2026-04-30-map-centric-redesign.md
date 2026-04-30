# Map-centric redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the existing home-page map to the entire app shell (`/`), layering on left-sidebar filters, a right listings panel, live-scan SSE with pin drops, a settings drawer, and a simplified 3-status pipeline; retire the per-profile table/kanban dashboard and the standalone home page.

**Architecture:** Single route `/` serving a fullscreen Leaflet map flanked by a left filter sidebar and a right listings panel. All filters apply client-side over a single `/api/map-listings` payload. Scan progress streams via SSE from a new `/api/run-scan-stream` endpoint that spawns the existing CLI scraper with a new `--events-fd=3` flag and forwards NDJSON events. Status pipeline collapses from 7 French states + `isRemoved` to three keys (`sorting`, `pursuing`, `archived`) via a one-time tracker migration on first storage access. A new `viewedAt` field tracks unread state.

**Tech Stack:** Vanilla JS (no framework, no bundler), zero npm deps, native `node:http` server, `node:test` for tests, Leaflet + Leaflet.markercluster from CDN, SSE via `text/event-stream`.

**Reference spec:** `docs/superpowers/specs/2026-04-30-map-centric-redesign-design.md`

**Tests:** Run individual files with `node --test tests/<file>.test.mjs` (the directory form fails on Node 22.15 in this repo). Use `node:test` + `node:assert/strict`. New test files go under `tests/`.

**Conventions in this codebase:**
- French UI labels; English code/comments.
- Conventional Commits: `feat(scope):`, `fix(scope):`, `refactor(scope):`, `chore(scope):`, `docs(scope):`, `test(scope):`.
- Atomic file writes: write to `*.tmp` then rename.
- `data/` is gitignored; migration only affects local files.
- **DOM construction safety:** the frontend snippets below use `textContent` + `createElement` + `append` rather than the bare HTML-string pattern. When you need richer markup, build it from elements; when you need text, set `textContent`. Avoid `innerHTML` with interpolated values.

---

## Phase 1 — Data model & migration

### Task 1: Status constants module

**Files:**
- Create: `scripts/status.mjs`
- Test: `tests/status.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/status.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATUS_KEYS,
  STATUS_LABELS,
  isValidStatus,
  migrateStatus,
  DEFAULT_STATUS
} from '../scripts/status.mjs';

test('STATUS_KEYS is the closed set sorting/pursuing/archived', () => {
  assert.deepEqual(STATUS_KEYS, ['sorting', 'pursuing', 'archived']);
});

test('DEFAULT_STATUS is sorting (newly-found listings start here)', () => {
  assert.equal(DEFAULT_STATUS, 'sorting');
});

test('STATUS_LABELS provides French UI labels for each key', () => {
  assert.equal(STATUS_LABELS.sorting, 'À trier');
  assert.equal(STATUS_LABELS.pursuing, 'À poursuivre');
  assert.equal(STATUS_LABELS.archived, 'Archivé');
});

test('isValidStatus accepts only the three keys', () => {
  assert.equal(isValidStatus('sorting'), true);
  assert.equal(isValidStatus('pursuing'), true);
  assert.equal(isValidStatus('archived'), true);
  assert.equal(isValidStatus('À contacter'), false);
  assert.equal(isValidStatus(''), false);
  assert.equal(isValidStatus(null), false);
  assert.equal(isValidStatus(undefined), false);
});

test('migrateStatus maps every legacy French status', () => {
  assert.equal(migrateStatus('À contacter'), 'sorting');
  assert.equal(migrateStatus('Visite'), 'pursuing');
  assert.equal(migrateStatus('Dossier'), 'pursuing');
  assert.equal(migrateStatus('Relance'), 'pursuing');
  assert.equal(migrateStatus('Accepté'), 'pursuing');
  assert.equal(migrateStatus('Refusé'), 'archived');
  assert.equal(migrateStatus('Sans réponse'), 'archived');
});

test('migrateStatus tolerates whitespace and case differences', () => {
  assert.equal(migrateStatus(' À contacter '), 'sorting');
  assert.equal(migrateStatus('REFUSÉ'), 'archived');
});

test('migrateStatus passes through already-new keys unchanged', () => {
  assert.equal(migrateStatus('sorting'), 'sorting');
  assert.equal(migrateStatus('pursuing'), 'pursuing');
  assert.equal(migrateStatus('archived'), 'archived');
});

test('migrateStatus returns null for unknown values so callers can decide', () => {
  assert.equal(migrateStatus(''), null);
  assert.equal(migrateStatus(null), null);
  assert.equal(migrateStatus('Random'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/status.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/status.mjs'`.

- [ ] **Step 3: Write the module**

```js
// scripts/status.mjs
export const STATUS_KEYS = ['sorting', 'pursuing', 'archived'];

export const DEFAULT_STATUS = 'sorting';

export const STATUS_LABELS = {
  sorting: 'À trier',
  pursuing: 'À poursuivre',
  archived: 'Archivé'
};

const LEGACY_TO_NEW = new Map([
  ['à contacter', 'sorting'],
  ['visite', 'pursuing'],
  ['dossier', 'pursuing'],
  ['relance', 'pursuing'],
  ['accepté', 'pursuing'],
  ['refusé', 'archived'],
  ['sans réponse', 'archived']
]);

export function isValidStatus(value) {
  return typeof value === 'string' && STATUS_KEYS.includes(value);
}

export function migrateStatus(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (STATUS_KEYS.includes(lower)) return lower;
  return LEGACY_TO_NEW.get(lower) || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/status.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/status.mjs tests/status.test.mjs
git commit -m "feat(status): add 3-state status module with legacy migration helper"
```

---

### Task 2: Tracker migration module

**Files:**
- Create: `scripts/tracker-migration.mjs`
- Test: `tests/tracker-migration.test.mjs`

The migration runs once per profile on first access. It rewrites every entry's `status` (mapping legacy French values), folds `isRemoved: true` into `status: 'archived'`, deletes the `isRemoved` field, and stamps `schemaVersion: 2` on the tracker root. It is a pure function over a tracker object — no I/O — so it's easy to test exhaustively.

- [ ] **Step 1: Write the failing test**

```js
// tests/tracker-migration.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tracker-migration.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```js
// scripts/tracker-migration.mjs
import { migrateStatus, DEFAULT_STATUS } from './status.mjs';

export const TRACKER_SCHEMA_VERSION = 2;

export function migrateTracker(input) {
  const source = input && typeof input === 'object' ? input : {};
  if (source.schemaVersion === TRACKER_SCHEMA_VERSION) {
    return { tracker: source, changed: false };
  }

  const listings = Array.isArray(source.listings) ? source.listings : [];
  const migratedListings = listings.map((listing) => {
    const next = { ...listing };
    const wasRemoved = next.isRemoved === true;
    delete next.isRemoved;

    if (wasRemoved) {
      next.status = 'archived';
    } else {
      next.status = migrateStatus(next.status) || DEFAULT_STATUS;
    }

    return next;
  });

  const tracker = { ...source, schemaVersion: TRACKER_SCHEMA_VERSION, listings: migratedListings };
  delete tracker.statuses;

  return { tracker, changed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tracker-migration.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/tracker-migration.mjs tests/tracker-migration.test.mjs
git commit -m "feat(migration): add pure tracker migration to schema v2"
```

---

### Task 3: Atomic JSON write helper + wire migration into `ensureProfileStorage`

**Files:**
- Modify: `scripts/serve-dashboard.mjs`

The migration is run lazily on `ensureProfileStorage()`. To prevent corruption from interleaved requests during the initial migration, write the migrated tracker via temp-file + rename. We also stop seeding new profiles with the legacy `statuses` array — the seed is now `{ schemaVersion: 2, listings: [] }`.

- [ ] **Step 1: Read the current `ensureProfileStorage` function**

Run: `grep -n "ensureProfileStorage\|tracker.json" scripts/serve-dashboard.mjs | head`

Locate the function. We need to:
- Add a `writeJsonAtomic(filePath, data)` helper near the existing JSON helpers.
- Inside `ensureProfileStorage`, after reading the existing tracker, call `migrateTracker`. If `changed === true`, write back atomically.
- Update the create-profile seed payload (around line 406) to `{ schemaVersion: 2, listings: [], updatedAt: new Date().toISOString() }`.

- [ ] **Step 2: Add the import and helper at the top of the file**

Near the existing imports add:

```js
import { migrateTracker, TRACKER_SCHEMA_VERSION } from './tracker-migration.mjs';
```

Near the existing `readJsonSafe` helper, add:

```js
async function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2));
  await fs.rename(tmpPath, filePath);
}
```

- [ ] **Step 3: Wire migration into `ensureProfileStorage`**

Inside `ensureProfileStorage`, after the existing tracker path is computed, add:

```js
const trackerPath = path.join(profileDir, 'tracker.json');
const existingTracker = await readJsonSafe(trackerPath, null);
if (existingTracker) {
  const { tracker, changed } = migrateTracker(existingTracker);
  if (changed) {
    await writeJsonAtomic(trackerPath, tracker);
  }
}
```

Adjust the surrounding code so this runs unconditionally on each `ensureProfileStorage` call (idempotent — `changed === false` after the first migration).

- [ ] **Step 4: Update the create-profile seed**

Find the line:

```js
await fs.writeFile(path.join(profileDir, 'tracker.json'), JSON.stringify({ listings: [], statuses: ['À contacter', 'Visite', 'Dossier', 'Relance', 'Accepté', 'Refusé', 'Sans réponse'], updatedAt: new Date().toISOString() }, null, 2));
```

Replace with:

```js
await writeJsonAtomic(
  path.join(profileDir, 'tracker.json'),
  { schemaVersion: TRACKER_SCHEMA_VERSION, listings: [], updatedAt: new Date().toISOString() }
);
```

- [ ] **Step 5: Smoke-test by hand**

Run: `npm start`
In another terminal: `curl -s http://localhost:8787/api/profiles | head -c 200`

Expected: 200 OK with profile list. Verify a local `data/profiles/<slug>/tracker.json` (if one exists) now has `"schemaVersion": 2` after the curl above.

- [ ] **Step 6: Commit**

```bash
git add scripts/serve-dashboard.mjs
git commit -m "feat(server): run tracker migration on profile access; atomic writes"
```

---

### Task 4: Update `map-listings.mjs` to expose new fields and stop pre-filtering by status

**Files:**
- Modify: `scripts/map-listings.mjs`
- Modify: `tests/map-listings.test.mjs`

Today `isMapVisibleListing` excludes listings where `isRemoved === true` or `status === 'Refusé'`. Post-migration there is no `isRemoved`, and status visibility is a client-side concern. The server should include all `active && display` listings regardless of status. The compact payload also needs the fields the new sidebar filters depend on: `status`, `priority`, `score`, `firstSeenAt`, `viewedAt`.

- [ ] **Step 1: Update the existing tests to use new statuses**

Open `tests/map-listings.test.mjs` and modify the `buildMapListingsPayload includes only active displayed non-refused listings with coordinates` test:

- Rename it to `buildMapListingsPayload includes every active displayed listing with coordinates regardless of status`.
- In its tracker fixture, change every `status: 'À contacter'` to `status: 'sorting'`, change `status: 'Refusé'` to `status: 'archived'`, and change ` Refusé ` (whitespace variant) to ` archived `.
- Drop the `isRemoved: true` test entry — it's no longer a real shape post-migration.
- Update assertions: `payload.profiles[0].totalActiveDisplayed` should be 3 (was 2), `payload.profiles[0].mappedCount` should be 2 (was 1), `payload.listings.length` should be 2.
- Inside the listings, assert that `payload.listings.find(l => l.id === 'refused').status === 'archived'`.

Add a fresh test:

```js
test('buildMapListingsPayload exposes status, priority, score, firstSeenAt, viewedAt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apartment-map-fields-'));
  const profilesDir = path.join(root, 'profiles');
  try {
    await writeJson(path.join(profilesDir, 'vevey', 'watch-config.json'), {
      shortTitle: 'Vevey'
    });
    await writeJson(path.join(profilesDir, 'vevey', 'tracker.json'), {
      schemaVersion: 2,
      listings: [
        {
          id: 'a',
          active: true,
          display: true,
          mapLat: 46.46,
          mapLon: 6.84,
          address: 'Rue A 1, 1800 Vevey',
          status: 'pursuing',
          priority: 'A',
          score: 87,
          firstSeenAt: '2026-04-15T10:00:00.000Z',
          viewedAt: '2026-04-20T08:00:00.000Z'
        }
      ]
    });

    const payload = await buildMapListingsPayload(profilesDir);
    const listing = payload.listings[0];

    assert.equal(listing.status, 'pursuing');
    assert.equal(listing.priority, 'A');
    assert.equal(listing.score, 87);
    assert.equal(listing.firstSeenAt, '2026-04-15T10:00:00.000Z');
    assert.equal(listing.viewedAt, '2026-04-20T08:00:00.000Z');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/map-listings.test.mjs`
Expected: FAIL — refused listing not in payload, missing fields on compact listing.

- [ ] **Step 3: Update the source**

In `scripts/map-listings.mjs`:

Replace `isMapVisibleListing` body with:

```js
function isMapVisibleListing(item = {}) {
  return item.active === true && item.display !== false;
}
```

Replace `compactListing`:

```js
function compactListing(item, profile, coords) {
  return {
    id: String(item.id),
    profileSlug: profile.slug,
    profileTitle: profile.title,
    profileColor: profile.color,
    title: item.objectType || item.title || item.address || 'Annonce',
    address: item.address || '',
    area: item.area || '',
    totalChf: toNumberOrNull(item.totalChf),
    rooms: toNumberOrNull(item.rooms),
    surfaceM2: toNumberOrNull(item.surfaceM2),
    source: item.source || '',
    url: item.url || '',
    imageUrls: listingImageUrls(item),
    lat: coords.lat,
    lon: coords.lon,
    status: typeof item.status === 'string' ? item.status : '',
    priority: typeof item.priority === 'string' ? item.priority : '',
    score: toNumberOrNull(item.score),
    firstSeenAt: item.firstSeenAt || null,
    viewedAt: item.viewedAt || null
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map-listings.test.mjs`
Expected: PASS for all tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/map-listings.mjs tests/map-listings.test.mjs
git commit -m "feat(map-listings): expose status/priority/score/firstSeenAt/viewedAt; drop server-side status pre-filter"
```

---

### Task 5: Scraper writes new statuses and treats auto-removal as `archived`

**Files:**
- Modify: `scripts/scrape-immobilier.mjs`

Two surgical edits:
1. New listings start as `status: 'sorting'` (replaces `'À contacter'`).
2. The auto-removal branch sets `status: 'archived'` instead of toggling `isRemoved: true`.

- [ ] **Step 1: Locate the new-listing creation site**

Run: `grep -n "À contacter" scripts/scrape-immobilier.mjs`

- [ ] **Step 2: Replace `'À contacter'` with `'sorting'`**

In every site that assigns the initial `status` for a brand-new tracker entry, replace the literal `'À contacter'` with `'sorting'`. Do NOT touch occurrences inside French UI strings — only the `status` field assignments.

- [ ] **Step 3: Locate the auto-removal site**

Run: `grep -n "isRemoved" scripts/scrape-immobilier.mjs`

- [ ] **Step 4: Update the auto-removal branch**

For each occurrence where the scraper sets `item.isRemoved = true`, replace with `item.status = 'archived'` and remove the `item.isRemoved` assignment so the field is not written back.

If the scraper later reads `isRemoved` for any reporting (e.g., a per-scan summary), update those reads to inspect `status === 'archived'` instead.

- [ ] **Step 5: Smoke-test the scraper**

Run: `npm run scan -- --profile=<your-test-profile>`

Expected: completes without error. Inspect `data/profiles/<slug>/tracker.json` and verify newly added listings have `status: 'sorting'` and the `isRemoved` field is absent.

- [ ] **Step 6: Commit**

```bash
git add scripts/scrape-immobilier.mjs
git commit -m "feat(scraper): write new 3-state statuses; auto-remove becomes archived"
```

---

## Phase 2 — Backend endpoints

### Task 6: `/api/update-status` validates new enum

**Files:**
- Modify: `scripts/serve-dashboard.mjs`

- [ ] **Step 1: Locate the existing handler**

Run: `grep -n "/api/update-status" scripts/serve-dashboard.mjs`

- [ ] **Step 2: Import and validate**

Add to the imports:

```js
import { isValidStatus } from './status.mjs';
```

In the handler, before calling `updateStatus`, add:

```js
if (!isValidStatus(body.status)) {
  return sendJson(res, 400, { ok: false, error: 'Statut invalide' });
}
```

- [ ] **Step 3: Smoke-test by hand**

Run: `npm start`
In another terminal:

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"id":"abc","status":"sorting"}' \
  'http://localhost:8787/api/update-status?profile=<slug>'
```

Expected: a JSON response (200 or 404 depending on whether `abc` exists) — but **not** 400.

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"id":"abc","status":"À contacter"}' \
  'http://localhost:8787/api/update-status?profile=<slug>'
```

Expected: `{"ok":false,"error":"Statut invalide"}` with HTTP 400.

- [ ] **Step 4: Commit**

```bash
git add scripts/serve-dashboard.mjs
git commit -m "feat(api): validate /api/update-status against the 3-state enum"
```

---

### Task 7: `/api/mark-viewed` endpoint

**Files:**
- Modify: `scripts/serve-dashboard.mjs`
- Create: `scripts/mark-viewed.mjs`
- Test: `tests/mark-viewed.test.mjs`

The endpoint accepts `{ids: string[]}` and sets `viewedAt = new Date().toISOString()` on each matching tracker entry. Pure logic lives in `applyViewedAt(tracker, ids, now)` and is unit-tested; the endpoint is a thin I/O wrapper.

- [ ] **Step 1: Write the failing test**

```js
// tests/mark-viewed.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mark-viewed.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper module**

```js
// scripts/mark-viewed.mjs
export function applyViewedAt(tracker, ids, now) {
  const source = tracker && typeof tracker === 'object' ? tracker : { listings: [] };
  const idSet = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  if (!idSet.size) return { tracker: source, updated: 0 };

  const listings = Array.isArray(source.listings) ? source.listings : [];
  let updated = 0;
  const next = listings.map((listing) => {
    if (!idSet.has(listing.id)) return listing;
    updated += 1;
    return { ...listing, viewedAt: now };
  });

  return { tracker: { ...source, listings: next }, updated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mark-viewed.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the HTTP endpoint**

In `scripts/serve-dashboard.mjs`:

Add the import:

```js
import { applyViewedAt } from './mark-viewed.mjs';
```

Add the route handler near the other `/api/...` routes:

```js
if (req.method === 'POST' && u.pathname === '/api/mark-viewed') {
  const profile = getProfileFromRequest(u);

  try {
    await ensureProfileStorage(profile);
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const ids = Array.isArray(body.ids) ? body.ids : [];

    const trackerPath = path.join(PROFILES_DATA_DIR, profile, 'tracker.json');
    const tracker = await readJsonSafe(trackerPath, { schemaVersion: TRACKER_SCHEMA_VERSION, listings: [] });
    const { tracker: next, updated } = applyViewedAt(tracker, ids, new Date().toISOString());
    if (updated > 0) await writeJsonAtomic(trackerPath, next);

    return sendJson(res, 200, { ok: true, updated });
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }
}
```

- [ ] **Step 6: Smoke-test by hand**

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"ids":["<known-id>"]}' \
  'http://localhost:8787/api/mark-viewed?profile=<slug>'
```

Expected: `{"ok":true,"updated":1}`. Inspect tracker file: `viewedAt` is set on the matching entry.

- [ ] **Step 7: Commit**

```bash
git add scripts/mark-viewed.mjs scripts/serve-dashboard.mjs tests/mark-viewed.test.mjs
git commit -m "feat(api): add /api/mark-viewed endpoint backed by pure helper"
```

---

### Task 8: Scraper `--events-fd` flag and `emitEvent` helper

**Files:**
- Modify: `scripts/scrape-immobilier.mjs`

Add a CLI flag `--events-fd=<n>`. When set, the scraper opens a writable stream on that fd and `emitEvent(obj)` writes one JSON line. When unset, `emitEvent` is a no-op.

- [ ] **Step 1: Find `parseProfileFromArgv`**

Run: `grep -n "parseProfileFromArgv\|process.argv" scripts/scrape-immobilier.mjs | head`

- [ ] **Step 2: Add the parser and helper**

Just below `parseProfileFromArgv`, add:

```js
function parseEventsFdFromArgv(argv = process.argv.slice(2)) {
  for (const arg of argv) {
    const match = String(arg || '').match(/^--events-fd=(\d+)$/);
    if (match) {
      const fd = Number(match[1]);
      return Number.isInteger(fd) && fd >= 3 ? fd : null;
    }
  }
  return null;
}

let eventsStream = null;
let eventsStreamReady = false;

function ensureEventsStream() {
  if (eventsStreamReady) return eventsStream;
  eventsStreamReady = true;
  const fd = parseEventsFdFromArgv();
  if (fd == null) {
    eventsStream = null;
    return null;
  }
  eventsStream = fsRaw.createWriteStream(null, { fd });
  eventsStream.on('error', () => { eventsStream = null; });
  return eventsStream;
}

export function emitEvent(payload) {
  const stream = ensureEventsStream();
  if (!stream) return;
  try {
    const line = JSON.stringify({ ...payload, at: payload.at || new Date().toISOString() });
    stream.write(line + '\n');
  } catch {
    // ignore — events are best-effort
  }
}
```

- [ ] **Step 3: Make sure `fs` (with `createWriteStream`) is available**

Look at the current imports at the top of `scripts/scrape-immobilier.mjs`. If only `node:fs/promises` is imported, add a side-by-side import for the sync API:

```js
import * as fsRaw from 'node:fs';
```

- [ ] **Step 4: Smoke-test that the flag is accepted but inert**

Run: `npm run scan -- --profile=<slug> --events-fd=3` (without redirecting fd 3 — Node will close it; the helper handles the error and continues).

Expected: scan completes normally with no events written and no crash.

Run: `npm run scan -- --profile=<slug>`

Expected: identical behavior to before — no flag, no emit.

- [ ] **Step 5: Commit**

```bash
git add scripts/scrape-immobilier.mjs
git commit -m "feat(scraper): add --events-fd flag and emitEvent helper (no-op when unset)"
```

---

### Task 9: Insert `emitEvent` calls at known points

**Files:**
- Modify: `scripts/scrape-immobilier.mjs`

Insert calls at scan-start, per-source-start, per-source-progress, per-listing upsert, per-source-done, scan-done, scan-error.

- [ ] **Step 1: Find `main()` and the per-source loop**

Run: `grep -n "async function main\|for (const source\|sourceList\|runSource\|sources\\.forEach" scripts/scrape-immobilier.mjs | head`

Note the line numbers for: top of `main()`, the loop iterating over sources, and the per-listing tracker upsert.

- [ ] **Step 2: Insert at scan-start**

Just after the start of `main()` and after `profile` and `config` are determined, add:

```js
emitEvent({ type: 'scan-start', profile, sources: Object.keys(config.sources || {}) });
```

- [ ] **Step 3: Insert at per-source-start and per-source-done**

Inside the per-source loop, immediately before fetching pages add:

```js
emitEvent({ type: 'source-start', source });
```

After all pages for a source are processed (before moving to the next source), add:

```js
emitEvent({ type: 'source-done', source, found: foundCount, kept: keptCount, errored: errorCount });
```

Use the variables already accumulated. If the scraper does not currently track these per-source counters, add three local counters at the top of the loop that increment in the natural places.

- [ ] **Step 4: Insert at per-source-progress**

After each page is parsed, add:

```js
emitEvent({ type: 'source-progress', source, page: pageNumber, totalPages: knownTotal || null, found: pageItemCount });
```

- [ ] **Step 5: Insert at per-listing upsert**

Run: `grep -n "tracker.listings.push\|trackerById\|firstSeenAt:" scripts/scrape-immobilier.mjs | head`

After the listing's tracker entry is finalized but before continuing, add:

```js
emitEvent({
  type: 'listing',
  listing: {
    id: trackerEntry.id,
    profile,
    lat: trackerEntry.mapLat ?? null,
    lon: trackerEntry.mapLon ?? null,
    title: trackerEntry.title || trackerEntry.address || '',
    address: trackerEntry.address || '',
    area: trackerEntry.area || '',
    totalChf: trackerEntry.totalChf ?? null,
    rooms: trackerEntry.rooms ?? null,
    surfaceM2: trackerEntry.surfaceM2 ?? null,
    source: trackerEntry.source || '',
    url: trackerEntry.url || '',
    imageUrls: trackerEntry.imageUrls || trackerEntry.imageUrlsLocal || [],
    status: trackerEntry.status,
    priority: trackerEntry.priority || '',
    score: trackerEntry.score ?? null,
    firstSeenAt: trackerEntry.firstSeenAt
  }
});
```

(Match the field names actually in use in the tracker entry around that block.)

- [ ] **Step 6: Insert at scan-done and scan-error**

At the end of `main()`, after the summary is computed:

```js
emitEvent({ type: 'scan-done', summary });
```

Replace the file's tail-end `main().catch(...)` handler with:

```js
main().catch((err) => {
  emitEvent({ type: 'scan-error', message: err && err.message ? err.message : String(err) });
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Smoke-test that events are emitted only when fd 3 is open**

Create a one-line test driver:

```bash
node -e "
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['scripts/scrape-immobilier.mjs', '--profile=<slug>', '--events-fd=3'], {
  stdio: ['ignore', 'inherit', 'inherit', 'pipe']
});
child.stdio[3].on('data', (d) => process.stdout.write('[EVENT] ' + d));
"
```

Expected: `[EVENT] {...}` lines for scan-start, source-start, source-progress, listing (many), source-done, scan-done.

Run the cron path for parity:

```bash
npm run scan -- --profile=<slug>
```

Expected: identical stdout to before this task — no `EVENT` markers, no behavior change.

- [ ] **Step 8: Commit**

```bash
git add scripts/scrape-immobilier.mjs
git commit -m "feat(scraper): emit lifecycle and per-listing NDJSON events when --events-fd is set"
```

---

### Task 10: `/api/run-scan-stream` SSE endpoint

**Files:**
- Modify: `scripts/serve-dashboard.mjs`

The endpoint:
- Spawns the scraper with `stdio: ['ignore','pipe','pipe','pipe']` and `--events-fd=3`.
- Reads fd 3 line-by-line.
- Forwards each NDJSON line as `data: <json>\n\n` SSE frames.
- Maintains an `activeScans` map keyed by slug; second start for the same slug returns 409.
- On child exit: sends `scan-done` (if not already emitted) or `scan-error`, then closes the stream.
- On client disconnect: kills the child, removes the map entry.

- [ ] **Step 1: Add the activeScans map near the top of the file**

```js
const activeScans = new Map(); // slug -> ChildProcess
```

- [ ] **Step 2: Add the route handler**

Place it near the other `/api/run-scan*` routes:

```js
if (req.method === 'GET' && u.pathname === '/api/run-scan-stream') {
  const profile = getProfileFromRequest(u);

  if (activeScans.has(profile)) {
    return sendJson(res, 409, { ok: false, error: 'Un scan est déjà en cours pour ce profil' });
  }

  await ensureProfileStorage(profile);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': stream open\n\n');

  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [SCRAPE_SCRIPT, `--profile=${profile}`, '--events-fd=3'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe']
  });
  activeScans.set(profile, child);

  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  let buffer = '';
  let scanDoneSent = false;

  const sendFrame = (payload) => {
    res.write('data: ' + JSON.stringify(payload) + '\n\n');
  };

  child.stdio[3].on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        sendFrame(event);
        if (event.type === 'scan-done' || event.type === 'scan-error') scanDoneSent = true;
      } catch {
        // skip malformed lines
      }
    }
  });

  const cleanup = () => {
    if (activeScans.get(profile) === child) activeScans.delete(profile);
  };

  child.on('exit', (code, signal) => {
    if (!scanDoneSent) {
      sendFrame({
        type: code === 0 ? 'scan-done' : 'scan-error',
        message: code === 0 ? 'ok' : `Scan exited (code=${code} signal=${signal || ''})`,
        at: new Date().toISOString()
      });
    }
    cleanup();
    try { res.end(); } catch {}
  });

  req.on('close', () => {
    if (!child.killed) child.kill('SIGTERM');
    cleanup();
  });

  return;
}
```

- [ ] **Step 3: Smoke-test by hand**

Run: `npm start`

In another terminal:

```bash
curl -N 'http://localhost:8787/api/run-scan-stream?profile=<slug>'
```

Expected: a sequence of `data: {...}` lines: `scan-start`, `source-start`, `listing` (many), `source-done`, more sources, `scan-done`.

Trigger a duplicate while the first is running:

```bash
curl -i -N 'http://localhost:8787/api/run-scan-stream?profile=<same-slug>'
```

Expected: HTTP 409 with `{"ok":false,"error":"Un scan est déjà en cours pour ce profil"}`.

- [ ] **Step 4: Commit**

```bash
git add scripts/serve-dashboard.mjs
git commit -m "feat(api): add /api/run-scan-stream SSE endpoint with concurrency guard"
```

---

### Task 11: Routing — `/` serves the new shell, old dashboard URL redirects

**Files:**
- Modify: `scripts/serve-dashboard.mjs`

This task only updates the routing wiring. Pointing `/` at `dashboard/index.html` is fine for now — Task 12 rewrites that file. We add a 302 redirect from `/{slug}/dashboard` to `/?profiles={slug}`. The home-page route disappears.

- [ ] **Step 1: Locate the current `/` and `/{slug}/dashboard` routes**

Run: `grep -n "home.html\|dashboard.html\|index.html\|profileDashboardMatch\|/dashboard'" scripts/serve-dashboard.mjs | head`

- [ ] **Step 2: Update `/` to serve `dashboard/index.html`**

Replace the `home.html` static-serving branch with:

```js
if (req.method === 'GET' && u.pathname === '/') {
  return serveFile(res, path.join(DASHBOARD_DIR, 'index.html'));
}
```

- [ ] **Step 3: Replace the `{slug}/dashboard` handler with a redirect**

```js
const profileDashboardMatch = u.pathname.match(/^\/([a-z0-9-]+)\/dashboard\/?$/i);
if (req.method === 'GET' && profileDashboardMatch) {
  const slug = profileDashboardMatch[1];
  res.writeHead(302, { Location: '/?profiles=' + encodeURIComponent(slug) });
  return res.end();
}
```

- [ ] **Step 4: Smoke-test**

Run: `npm start`. Visit `http://localhost:8787/` — should serve the existing dashboard page (until Task 12 rewrites it). Visit `http://localhost:8787/<slug>/dashboard` — browser address bar should rewrite to `http://localhost:8787/?profiles=<slug>`.

- [ ] **Step 5: Commit**

```bash
git add scripts/serve-dashboard.mjs
git commit -m "refactor(server): / serves the unified shell; old per-profile dashboard 302s"
```

---

## Phase 3 — Frontend

### Task 12: New `index.html` shell skeleton

**Files:**
- Modify: `dashboard/index.html`

Rewrite the file as the empty skeleton of the new shell. No JS wiring yet — that comes in subsequent tasks. The skeleton commits the markup structure so later tasks can target stable selectors.

- [ ] **Step 1: Replace the file contents**

Write the following to `dashboard/index.html`:

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Apartment Ops</title>

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />

    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer" />

    <link rel="stylesheet" href="/dashboard/tokens.css" />
    <link rel="stylesheet" href="/dashboard/components.css" />
    <link rel="stylesheet" href="/dashboard/styles.css" />
  </head>
  <body class="app-body">
    <header class="app-topbar">
      <a href="/" class="brand"><span class="brand-dot"></span>Apartment Ops</a>
      <span class="grow"></span>
      <span id="scan-status" class="scan-status hidden"></span>
      <button id="scan-button" class="btn btn-primary btn-sm" type="button">Scanner</button>
    </header>

    <div class="app-shell">
      <aside id="sidebar" class="app-sidebar" aria-label="Filtres">
        <section class="sidebar-section" data-section="profiles">
          <header class="sidebar-section-head">Profils</header>
          <div class="sidebar-section-body" id="filter-profiles"></div>
        </section>

        <section class="sidebar-section" data-section="recent">
          <header class="sidebar-section-head">Trouvées récemment</header>
          <div class="sidebar-section-body">
            <select id="filter-recent" class="select-trigger">
              <option value="any">N'importe quand</option>
              <option value="1d">Dernières 24h</option>
              <option value="3d">3 derniers jours</option>
              <option value="7d">7 derniers jours</option>
              <option value="14d">14 derniers jours</option>
            </select>
          </div>
        </section>

        <section class="sidebar-section" data-section="unread">
          <header class="sidebar-section-head">Non lues</header>
          <div class="sidebar-section-body">
            <label class="toggle">
              <input type="checkbox" id="filter-unread" />
              <span>Afficher uniquement les non lues</span>
            </label>
          </div>
        </section>

        <section class="sidebar-section" data-section="status">
          <header class="sidebar-section-head">Statut</header>
          <div class="sidebar-section-body" id="filter-status"></div>
        </section>

        <section class="sidebar-section" data-section="priority">
          <header class="sidebar-section-head">Priorité</header>
          <div class="sidebar-section-body" id="filter-priority"></div>
        </section>

        <section class="sidebar-section" data-section="sources">
          <header class="sidebar-section-head">Sources</header>
          <div class="sidebar-section-body" id="filter-sources"></div>
        </section>

        <footer class="sidebar-foot">
          <button id="settings-button" class="btn btn-ghost btn-sm" type="button">Paramètres</button>
        </footer>
      </aside>

      <main id="map-container" class="app-map" aria-label="Carte des annonces">
        <div id="map" class="map-canvas"></div>
        <div id="scan-progress" class="scan-progress hidden" role="status" aria-live="polite">
          <div class="scan-progress-source"></div>
          <div class="scan-progress-counter"></div>
          <div class="scan-progress-bar"></div>
        </div>
      </main>

      <aside id="listings-panel" class="app-listings" aria-label="Annonces">
        <header class="listings-head">
          <span id="listings-count">0 annonces</span>
        </header>
        <div id="listings-rows" class="listings-rows"></div>
      </aside>
    </div>

    <div id="settings-drawer" class="drawer hidden" role="dialog" aria-modal="true" aria-labelledby="settings-drawer-title">
      <div class="drawer-overlay" data-drawer-close></div>
      <div class="drawer-panel">
        <header class="drawer-head">
          <h2 id="settings-drawer-title">Profils</h2>
          <button class="drawer-close" type="button" data-drawer-close aria-label="Fermer">×</button>
        </header>
        <div id="drawer-body" class="drawer-body"></div>
      </div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script type="module" src="/dashboard/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Smoke-test that the page loads**

Run: `npm start`. Open `http://localhost:8787/` in a browser. Verify the page renders the brand, sidebar sections (empty bodies), an empty map area, and an empty right panel. The console will have errors from the still-old `app.js` not finding old IDs; that's fine for this commit.

- [ ] **Step 3: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(shell): rewrite index.html as the map-centric app skeleton"
```

---

### Task 13: Pure filter logic module + tests

**Files:**
- Create: `dashboard/filter-logic.js`
- Test: `tests/filter-logic.test.mjs`

The sidebar filters are pure: given the current filter state and the listing payload, return the visible subset.

- [ ] **Step 1: Write the failing test**

```js
// tests/filter-logic.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFilters, defaultFilterState } from '../dashboard/filter-logic.js';

const NOW = new Date('2026-04-30T12:00:00.000Z').getTime();

const fixture = [
  { id: 'a', profileSlug: 'p1', status: 'sorting', priority: 'A', source: 'flatfox.ch', firstSeenAt: '2026-04-29T12:00:00.000Z', viewedAt: null },
  { id: 'b', profileSlug: 'p1', status: 'pursuing', priority: 'A-', source: 'flatfox.ch', firstSeenAt: '2026-04-15T00:00:00.000Z', viewedAt: '2026-04-25T08:00:00.000Z' },
  { id: 'c', profileSlug: 'p2', status: 'archived', priority: 'B', source: 'naef.ch', firstSeenAt: '2026-03-10T00:00:00.000Z', viewedAt: null },
  { id: 'd', profileSlug: 'p2', status: 'sorting', priority: 'A', source: 'immobilier.ch', firstSeenAt: '2026-04-26T12:00:00.000Z', viewedAt: null }
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/filter-logic.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```js
// dashboard/filter-logic.js
export function defaultFilterState() {
  return {
    hiddenProfiles: new Set(),
    recent: 'any',
    unreadOnly: false,
    statuses: new Set(['sorting', 'pursuing']),
    priorities: new Set(['A', 'A-', 'B']),
    sources: null
  };
}

const RECENT_TO_MS = {
  any: null,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000
};

export function applyFilters(listings, state, nowMs = Date.now()) {
  const recentWindow = RECENT_TO_MS[state.recent] ?? null;
  return listings.filter((listing) => {
    if (state.hiddenProfiles && state.hiddenProfiles.has(listing.profileSlug)) return false;
    if (recentWindow != null) {
      const t = listing.firstSeenAt ? Date.parse(listing.firstSeenAt) : NaN;
      if (!Number.isFinite(t) || nowMs - t > recentWindow) return false;
    }
    if (state.unreadOnly && listing.viewedAt) return false;
    if (state.statuses && !state.statuses.has(listing.status)) return false;
    if (state.priorities && listing.priority && !state.priorities.has(listing.priority)) return false;
    if (state.priorities && !listing.priority) return false;
    if (state.sources && !state.sources.has(listing.source)) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/filter-logic.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/filter-logic.js tests/filter-logic.test.mjs
git commit -m "feat(filters): add pure filter-logic module with unit tests"
```

---

### Task 14: Map module — extract from `home.js`

**Files:**
- Create: `dashboard/map.js`

Lift the Leaflet glue from `home.js` into a focused module. Public API:

- `initMap(container)` — creates the Leaflet instance + a marker cluster group; returns `{ map }`.
- `setListings(listings)` — replaces all markers in one go.
- `addListing(listing, { animate })` — adds one marker (used during live scans).
- `removeListing(id)` — removes a marker.
- `focusListing(id, { openPopup })` — pans/zooms to the marker, optionally opens its popup.
- `setProfileVisibility(slug, visible)` — toggles a per-profile layer group.
- `onMarkerClick(handler)` — registers a click handler that receives the listing id.

Clustering rules: cluster only at zoom ≥ 13; below that, render small unclustered dots.

- [ ] **Step 1: Read `home.js` for reference**

Open `dashboard/home.js`. Skim the Leaflet glue: `mapInstance` init, the divIcon factory, the per-listing marker creation, fit-bounds, popup wiring.

- [ ] **Step 2: Write the new module**

Create `dashboard/map.js` with the public API. The marker icons are constructed via `L.divIcon` with templated HTML — but here the HTML is fixed content (no user-supplied values are ever interpolated raw). The `popupHtml` helper in `dashboard/map-utils.js` already escapes user content.

```js
// dashboard/map.js
import { popupHtml } from '/dashboard/map-utils.js';

const SWITZERLAND_VIEW = { center: [46.8182, 8.2275], zoom: 8 };
const DETAIL_ZOOM = 13;

let map = null;
let clusterGroup = null;
let dotsGroup = null;
const markersById = new Map();
const profileVisibility = new Map();
let markerClickHandler = () => {};

export function initMap(container) {
  if (map) return { map };
  map = L.map(container, { preferCanvas: false }).setView(SWITZERLAND_VIEW.center, SWITZERLAND_VIEW.zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  clusterGroup = L.markerClusterGroup({ disableClusteringAtZoom: 18, showCoverageOnHover: false });
  dotsGroup = L.layerGroup();
  applyZoomMode();
  map.on('zoomend', applyZoomMode);

  return { map };
}

function applyZoomMode() {
  if (!map) return;
  const zoom = map.getZoom();
  if (zoom >= DETAIL_ZOOM) {
    if (map.hasLayer(dotsGroup)) map.removeLayer(dotsGroup);
    if (!map.hasLayer(clusterGroup)) map.addLayer(clusterGroup);
  } else {
    if (map.hasLayer(clusterGroup)) map.removeLayer(clusterGroup);
    if (!map.hasLayer(dotsGroup)) map.addLayer(dotsGroup);
  }
}

function isProfileVisible(slug) {
  return profileVisibility.get(slug) !== false;
}

function safeColor(color) {
  // Allow only hex (#xxx, #xxxxxx) or hsl(...) values that came from our own palette.
  const value = String(color || '#56d4b8');
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^hsl\(\s*-?\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%\s*\)$/i.test(value)) return value;
  return '#56d4b8';
}

function detailIcon(listing) {
  const color = safeColor(listing.profileColor);
  // Build the icon DOM imperatively rather than via innerHTML.
  const wrapper = document.createElement('span');
  wrapper.className = 'pin';
  wrapper.style.setProperty('--pin-color', color);
  return L.divIcon({
    className: 'map-marker-detail',
    html: wrapper.outerHTML,
    iconSize: [24, 30],
    iconAnchor: [12, 30],
    popupAnchor: [0, -28]
  });
}

function dotIcon(listing) {
  const color = safeColor(listing.profileColor);
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = color;
  return L.divIcon({
    className: 'map-marker-dot',
    html: dot.outerHTML,
    iconSize: [8, 8],
    iconAnchor: [4, 4]
  });
}

function attachMarker(listing, opts) {
  if (typeof listing.lat !== 'number' || typeof listing.lon !== 'number') return null;
  if (!isProfileVisible(listing.profileSlug)) return null;

  const detail = L.marker([listing.lat, listing.lon], { icon: detailIcon(listing) });
  detail.bindPopup(popupHtml(listing));
  detail.on('click', () => markerClickHandler(listing.id));
  clusterGroup.addLayer(detail);

  const dot = L.marker([listing.lat, listing.lon], { icon: dotIcon(listing) });
  dot.on('click', () => markerClickHandler(listing.id));
  dotsGroup.addLayer(dot);

  if (opts && opts.animate) {
    detail.once('add', () => {
      const el = detail.getElement();
      if (el) el.classList.add('marker-drop');
    });
  }

  markersById.set(listing.id, { detail, dot, listing });
  return detail;
}

export function setListings(listings) {
  clusterGroup.clearLayers();
  dotsGroup.clearLayers();
  markersById.clear();
  for (const listing of listings) attachMarker(listing);
}

export function addListing(listing, opts) {
  const existing = markersById.get(listing.id);
  if (existing) {
    clusterGroup.removeLayer(existing.detail);
    dotsGroup.removeLayer(existing.dot);
    markersById.delete(listing.id);
  }
  attachMarker(listing, opts);
}

export function removeListing(id) {
  const entry = markersById.get(id);
  if (!entry) return;
  clusterGroup.removeLayer(entry.detail);
  dotsGroup.removeLayer(entry.dot);
  markersById.delete(id);
}

export function focusListing(id, opts) {
  const entry = markersById.get(id);
  if (!entry) return;
  map.setView(entry.detail.getLatLng(), Math.max(map.getZoom(), DETAIL_ZOOM));
  if (opts && opts.openPopup) entry.detail.openPopup();
}

export function setProfileVisibility(slug, visible) {
  profileVisibility.set(slug, visible);
  for (const [, entry] of markersById) {
    if (entry.listing.profileSlug !== slug) continue;
    if (visible) {
      clusterGroup.addLayer(entry.detail);
      dotsGroup.addLayer(entry.dot);
    } else {
      clusterGroup.removeLayer(entry.detail);
      dotsGroup.removeLayer(entry.dot);
    }
  }
}

export function onMarkerClick(handler) {
  markerClickHandler = typeof handler === 'function' ? handler : () => {};
}

export function getMap() {
  return map;
}
```

- [ ] **Step 3: Smoke test (deferred)**

Hold off until Task 19 wires the entrypoint.

- [ ] **Step 4: Commit**

```bash
git add dashboard/map.js
git commit -m "feat(map): extract Leaflet map module with cluster + dot zoom modes"
```

---

### Task 15: Sidebar module — render filters and emit state changes

**Files:**
- Create: `dashboard/sidebar.js`

DOM module built imperatively (`createElement` + `append` + `textContent`). Public API: `renderSidebar({ profiles, sources }, state, onChange)` populates the placeholder elements set up in `index.html` and wires checkbox/select/eye-button handlers. `onChange(nextState)` is called with the entire next filter state on every change.

- [ ] **Step 1: Write the module**

```js
// dashboard/sidebar.js
const STATUS_LABELS = { sorting: 'À trier', pursuing: 'À poursuivre', archived: 'Archivé' };
const PRIORITY_KEYS = ['A', 'A-', 'B'];

export function renderSidebar({ profiles, sources }, state, onChange) {
  const profilesEl = document.getElementById('filter-profiles');
  const recentEl = document.getElementById('filter-recent');
  const unreadEl = document.getElementById('filter-unread');
  const statusEl = document.getElementById('filter-status');
  const priorityEl = document.getElementById('filter-priority');
  const sourcesEl = document.getElementById('filter-sources');

  const emit = (mutator) => {
    const next = clone(state);
    mutator(next);
    Object.assign(state, next);
    onChange(clone(state));
  };

  // --- Profiles
  profilesEl.replaceChildren();
  for (const profile of profiles) {
    const row = document.createElement('div');
    row.className = 'filter-profile-row';

    const dot = document.createElement('span');
    dot.className = 'profile-dot';
    dot.style.background = profile.color || '#56d4b8';

    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = profile.title;

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'profile-eye';
    const visible = !state.hiddenProfiles.has(profile.slug);
    if (!visible) eye.classList.add('off');
    eye.setAttribute('aria-label', visible ? 'Masquer' : 'Afficher');
    eye.textContent = visible ? '👁' : '🚫';
    eye.addEventListener('click', () => {
      emit((next) => {
        const set = new Set(next.hiddenProfiles);
        if (set.has(profile.slug)) set.delete(profile.slug); else set.add(profile.slug);
        next.hiddenProfiles = set;
      });
    });

    row.append(dot, name, eye);
    profilesEl.appendChild(row);
  }

  // --- Recent
  recentEl.value = state.recent;
  recentEl.addEventListener('change', () => {
    emit((next) => { next.recent = recentEl.value; });
  });

  // --- Unread
  unreadEl.checked = state.unreadOnly === true;
  unreadEl.addEventListener('change', () => {
    emit((next) => { next.unreadOnly = unreadEl.checked; });
  });

  // --- Status
  statusEl.replaceChildren();
  for (const key of Object.keys(STATUS_LABELS)) {
    statusEl.appendChild(buildCheckbox({
      label: STATUS_LABELS[key],
      checked: state.statuses.has(key),
      onChange: (checked) => emit((next) => {
        const set = new Set(next.statuses);
        if (checked) set.add(key); else set.delete(key);
        next.statuses = set;
      })
    }));
  }

  // --- Priority
  priorityEl.replaceChildren();
  for (const key of PRIORITY_KEYS) {
    priorityEl.appendChild(buildCheckbox({
      label: key,
      checked: state.priorities.has(key),
      onChange: (checked) => emit((next) => {
        const set = new Set(next.priorities);
        if (checked) set.add(key); else set.delete(key);
        next.priorities = set;
      })
    }));
  }

  // --- Sources
  if (state.sources == null) state.sources = new Set(sources);
  sourcesEl.replaceChildren();
  for (const source of sources) {
    sourcesEl.appendChild(buildCheckbox({
      label: source,
      checked: state.sources.has(source),
      onChange: (checked) => emit((next) => {
        const set = new Set(next.sources || []);
        if (checked) set.add(source); else set.delete(source);
        next.sources = set;
      })
    }));
  }
}

function buildCheckbox({ label, checked, onChange }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'filter-checkbox';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.textContent = ' ' + label;
  wrapper.append(input, text);
  return wrapper;
}

function clone(state) {
  return {
    hiddenProfiles: new Set(state.hiddenProfiles),
    recent: state.recent,
    unreadOnly: state.unreadOnly,
    statuses: new Set(state.statuses),
    priorities: new Set(state.priorities),
    sources: state.sources ? new Set(state.sources) : null
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/sidebar.js
git commit -m "feat(sidebar): render filter controls and emit state changes"
```

---

### Task 16: Listings panel module — list, hover sync, viewedAt batching

**Files:**
- Create: `dashboard/listings-panel.js`

Renders a vertical list inside `#listings-rows`. Render up to 200 rows; if more, render the first 200 + a footer counting the rest (true virtualization is a follow-up).

Public API:
- `renderListings(listings, handlers)` — `handlers.onClick(id)`, `handlers.onHover(id)`, `handlers.onMarkViewed(idsArray)`.
- `highlightRow(id)` — scrolls the row into view and adds a transient class.
- `markRowAsRead(id)` — removes the unread accent.

- [ ] **Step 1: Write the module**

```js
// dashboard/listings-panel.js

const CAP = 200;
const VIEWED_DEBOUNCE_MS = 2000;
const VIEW_DWELL_MS = 1000;

let pendingIds = new Set();
let flushTimer = null;
let onMarkViewedHandler = () => {};
let listingMap = new Map();
let observer = null;
let viewedDwellTimers = new Map();

export function renderListings(listings, handlers) {
  onMarkViewedHandler = handlers.onMarkViewed || (() => {});
  const rowsEl = document.getElementById('listings-rows');
  const countEl = document.getElementById('listings-count');

  rowsEl.replaceChildren();
  listingMap = new Map();

  const visible = listings.slice(0, CAP);
  for (const listing of visible) {
    listingMap.set(listing.id, listing);
    rowsEl.appendChild(buildRow(listing, handlers));
  }

  if (listings.length > CAP) {
    const more = document.createElement('div');
    more.className = 'listings-more';
    more.textContent = '+' + (listings.length - CAP) + ' annonces masquées (affinez les filtres)';
    rowsEl.appendChild(more);
  }

  countEl.textContent = listings.length + ' annonce' + (listings.length === 1 ? '' : 's');

  attachViewObserver(rowsEl);
}

function buildRow(listing, handlers) {
  const row = document.createElement('article');
  row.className = 'listing-row';
  if (!listing.viewedAt) row.classList.add('is-unread');
  row.dataset.id = listing.id;
  row.style.setProperty('--profile-color', listing.profileColor || '#56d4b8');

  const accent = document.createElement('div');
  accent.className = 'row-accent';

  const thumb = document.createElement('div');
  thumb.className = 'row-thumb';
  if (listing.imageUrls && listing.imageUrls[0]) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = listing.imageUrls[0];
    img.alt = '';
    thumb.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'row-body';

  const title = document.createElement('strong');
  title.textContent = listing.title || listing.address || 'Annonce';

  const meta = document.createElement('div');
  meta.className = 'row-meta';
  const metaParts = [];
  if (listing.totalChf) metaParts.push('CHF ' + listing.totalChf.toLocaleString('fr-CH'));
  if (listing.rooms) metaParts.push(listing.rooms + ' p');
  if (listing.surfaceM2) metaParts.push(listing.surfaceM2 + ' m²');
  meta.textContent = metaParts.join(' · ');

  const sub = document.createElement('div');
  sub.className = 'row-meta-sub';
  sub.textContent = (listing.area || '') + (listing.area && listing.source ? ' · ' : '') + (listing.source || '');

  body.append(title, meta, sub);

  const side = document.createElement('div');
  side.className = 'row-side';
  if (listing.score != null) {
    const score = document.createElement('span');
    score.className = 'score-pill';
    score.textContent = String(listing.score);
    side.appendChild(score);
  }

  row.append(accent, thumb, body, side);
  row.addEventListener('click', () => handlers.onClick && handlers.onClick(listing.id));
  row.addEventListener('mouseenter', () => handlers.onHover && handlers.onHover(listing.id));
  return row;
}

function attachViewObserver(rowsEl) {
  if (observer) observer.disconnect();
  for (const t of viewedDwellTimers.values()) clearTimeout(t);
  viewedDwellTimers = new Map();

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.dataset.id;
      if (!id) continue;
      if (entry.isIntersecting) {
        const listing = listingMap.get(id);
        if (!listing || listing.viewedAt) continue;
        const timer = setTimeout(() => queueViewed(id), VIEW_DWELL_MS);
        viewedDwellTimers.set(id, timer);
      } else {
        const t = viewedDwellTimers.get(id);
        if (t) { clearTimeout(t); viewedDwellTimers.delete(id); }
      }
    }
  }, { root: rowsEl, threshold: 0.4 });

  for (const row of rowsEl.querySelectorAll('.listing-row')) observer.observe(row);
}

export function queueViewed(id) {
  if (!id) return;
  pendingIds.add(id);
  if (!flushTimer) {
    flushTimer = setTimeout(flushViewed, VIEWED_DEBOUNCE_MS);
  }
}

function flushViewed() {
  flushTimer = null;
  if (!pendingIds.size) return;
  const ids = [...pendingIds];
  pendingIds = new Set();
  onMarkViewedHandler(ids);
}

export function highlightRow(id) {
  const row = findRow(id);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('is-flash');
  setTimeout(() => row.classList.remove('is-flash'), 1200);
}

export function markRowAsRead(id) {
  const row = findRow(id);
  if (row) row.classList.remove('is-unread');
}

function findRow(id) {
  const escaped = (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
  return document.querySelector('.listing-row[data-id="' + escaped + '"]');
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/listings-panel.js
git commit -m "feat(listings-panel): render rows with hover sync and viewedAt batching"
```

---

### Task 17: Scan module — EventSource client + progress overlay

**Files:**
- Create: `dashboard/scan.js`

`startScan(profileSlug, callbacks)` opens an EventSource and dispatches typed callbacks. The progress overlay is rendered into `#scan-progress`.

- [ ] **Step 1: Write the module**

```js
// dashboard/scan.js
let activeSource = null;

export function startScan(profileSlug, opts = {}) {
  const onListing = opts.onListing || (() => {});
  const onSourceStart = opts.onSourceStart || (() => {});
  const onSourceProgress = opts.onSourceProgress || (() => {});
  const onSourceDone = opts.onSourceDone || (() => {});
  const onScanDone = opts.onScanDone || (() => {});
  const onScanError = opts.onScanError || (() => {});

  if (activeSource) activeSource.close();

  const overlay = document.getElementById('scan-progress');
  const sourceEl = overlay.querySelector('.scan-progress-source');
  const counterEl = overlay.querySelector('.scan-progress-counter');
  overlay.classList.remove('hidden');
  let foundCount = 0;
  let currentSource = '';

  const setHeader = () => {
    sourceEl.textContent = currentSource ? currentSource : 'Démarrage…';
    counterEl.textContent = '+' + foundCount;
  };
  setHeader();

  activeSource = new EventSource('/api/run-scan-stream?profile=' + encodeURIComponent(profileSlug));
  activeSource.onmessage = (msg) => {
    let event;
    try { event = JSON.parse(msg.data); } catch { return; }

    switch (event.type) {
      case 'scan-start':
        foundCount = 0; currentSource = ''; setHeader(); break;
      case 'source-start':
        currentSource = event.source; setHeader(); onSourceStart(event); break;
      case 'source-progress':
        onSourceProgress(event); break;
      case 'listing':
        foundCount += 1; setHeader(); onListing(event.listing); break;
      case 'source-done':
        onSourceDone(event); break;
      case 'scan-done':
        cleanup(); onScanDone(event); break;
      case 'scan-error':
        cleanup(); onScanError(event); break;
    }
  };
  activeSource.onerror = () => {
    cleanup();
    onScanError({ type: 'scan-error', message: 'Connexion interrompue' });
  };

  function cleanup() {
    overlay.classList.add('hidden');
    if (activeSource) { activeSource.close(); activeSource = null; }
  }

  return () => {
    if (activeSource) activeSource.close();
    activeSource = null;
    overlay.classList.add('hidden');
  };
}

export function isScanActive() {
  return activeSource != null;
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/scan.js
git commit -m "feat(scan): EventSource client + progress overlay rendering"
```

---

### Task 18: Settings drawer module — lift profile CRUD from `home.js`

**Files:**
- Create: `dashboard/settings-drawer.js`

The drawer has two views: a list of profiles, and the per-profile editor form. The editor form is a near-direct lift of the existing `home.js` form (title, zones autocomplete, budget min/max, rooms, surface, workplace address, sources, preferences).

This task **ports** the equivalent code from `dashboard/home.js`, adapting it to render into `#drawer-body` and to use the `replaceChildren` + `createElement` pattern (no innerHTML interpolation). Identify:

- The form-rendering function in `home.js`.
- The zone autocomplete helper.
- The workplace-address autocomplete helper.
- The submit handler (which posts to `/api/profile/create` or `/api/profile/update`).
- The delete handler (which posts to `/api/profile/delete`).

- [ ] **Step 1: Skeleton module**

```js
// dashboard/settings-drawer.js

let drawerEl = null;
let onProfilesChangedHandler = () => {};

export function initDrawer(opts) {
  drawerEl = document.getElementById('settings-drawer');
  onProfilesChangedHandler = (opts && opts.onProfilesChanged) || (() => {});

  drawerEl.querySelectorAll('[data-drawer-close]').forEach((el) => {
    el.addEventListener('click', closeDrawer);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawerEl.classList.contains('hidden')) closeDrawer();
    if (e.key === ',' && !isTypingInForm(e.target)) openDrawer();
  });
  document.getElementById('settings-button').addEventListener('click', () => openDrawer());
}

export async function openDrawer(opts) {
  drawerEl.classList.remove('hidden');
  const slug = opts && opts.slug ? opts.slug : null;
  if (slug) {
    await renderEditor(slug);
  } else {
    await renderList();
  }
}

export function closeDrawer() {
  drawerEl.classList.add('hidden');
}

async function renderList() {
  const body = document.getElementById('drawer-body');
  body.replaceChildren();

  const newButton = document.createElement('button');
  newButton.id = 'drawer-new-profile';
  newButton.className = 'btn btn-primary btn-sm';
  newButton.type = 'button';
  newButton.textContent = 'Nouveau profil';
  newButton.addEventListener('click', () => renderEditor(null));
  body.appendChild(newButton);

  const listEl = document.createElement('div');
  listEl.id = 'drawer-profile-list';
  body.appendChild(listEl);

  const profiles = await fetch('/api/profiles').then((r) => r.json()).then((j) => j.profiles || []);

  if (profiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'drawer-empty';
    empty.textContent = 'Aucun profil. Créez le premier.';
    listEl.appendChild(empty);
    return;
  }

  for (const p of profiles) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'drawer-profile-row';
    row.dataset.slug = p.slug;

    const dot = document.createElement('span');
    dot.className = 'profile-dot';
    dot.style.background = p.color || '#56d4b8';

    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = p.shortTitle || p.slug;

    const meta = document.createElement('span');
    meta.className = 'profile-meta';
    meta.textContent = (p.areas || []).length + ' zones';

    const chev = document.createElement('span');
    chev.className = 'chevron';
    chev.textContent = '›';

    row.append(dot, name, meta, chev);
    row.addEventListener('click', () => renderEditor(row.dataset.slug));
    listEl.appendChild(row);
  }
}

async function renderEditor(slug) {
  const body = document.getElementById('drawer-body');
  body.replaceChildren();

  const profile = slug ? await fetch('/api/profile/detail?profile=' + encodeURIComponent(slug))
    .then((r) => r.json()).then((j) => j.profile) : null;

  // PORT FROM home.js:
  //   - Build the form fields imperatively (createElement / append).
  //   - Reuse the existing field shapes (shortTitle, zones, budget, rooms,
  //     surface, workplace, sources, preferences).
  //   - Reuse the zone autocomplete and workplace autocomplete helpers from
  //     home.js — copy them into this module verbatim.
  //   - Wire submit to call onSubmit(profile, form values).
  //   - Wire delete (only when profile exists) to call onDelete(slug).

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'editor-back';
  back.textContent = '← Retour';
  back.addEventListener('click', renderList);
  body.appendChild(back);

  // ...build the rest of the form imperatively. See home.js for the field set.
}

async function onSubmit(profile, payload) {
  const url = profile ? '/api/profile/update' : '/api/profile/create';
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  onProfilesChangedHandler();
  await renderList();
}

async function onDelete(slug) {
  if (!confirm('Supprimer le profil "' + slug + '" ?')) return;
  await fetch('/api/profile/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug })
  });
  onProfilesChangedHandler();
  await renderList();
}

function isTypingInForm(target) {
  return target && /input|textarea|select/i.test(target.tagName);
}
```

- [ ] **Step 2: Port the form fields and autocompletes from `home.js`**

This is the substantive work for this task. Open `dashboard/home.js` and locate:

- The form-build function (search for the `shortTitle` field).
- The zone autocomplete (search for `geo.admin.ch` or `gg25`).
- The workplace autocomplete (search for the workplace input handler).

Port each into `settings-drawer.js`'s `renderEditor` body and its helper functions. The form must produce the same JSON payload as today's `/api/profile/create` and `/api/profile/update` consume — see `buildConfigFromPayload` in `scripts/serve-dashboard.mjs`.

Use the imperative DOM pattern: `document.createElement` + `append` + `textContent`. No HTML-string templates with interpolation.

- [ ] **Step 3: Smoke-test (deferred)**

The drawer is wired in Task 19. Hold off until then.

- [ ] **Step 4: Commit**

```bash
git add dashboard/settings-drawer.js
git commit -m "feat(settings): drawer-based profile CRUD lifted from home.js"
```

---

### Task 19: Wire `app.js` as the entrypoint

**Files:**
- Modify: `dashboard/app.js`

Replace the entire contents with the new entrypoint. Imports the modules from Tasks 13–18 and orchestrates them.

- [ ] **Step 1: Replace `dashboard/app.js` contents**

```js
// dashboard/app.js
import { initMap, setListings, addListing, focusListing, setProfileVisibility, onMarkerClick } from '/dashboard/map.js';
import { applyFilters, defaultFilterState } from '/dashboard/filter-logic.js';
import { renderSidebar } from '/dashboard/sidebar.js';
import { renderListings, highlightRow, markRowAsRead, queueViewed } from '/dashboard/listings-panel.js';
import { startScan, isScanActive } from '/dashboard/scan.js';
import { initDrawer, openDrawer } from '/dashboard/settings-drawer.js';

const STATE_KEY = 'apartment-ops:filter-state:v1';
const SOURCES = ['immobilier.ch', 'flatfox.ch', 'naef.ch', 'bernard-nicod.ch', 'retraites-populaires', 'anibis.ch'];

const state = {
  filter: hydrateFilterState(),
  payload: { profiles: [], listings: [] }
};

async function bootstrap() {
  initMap(document.getElementById('map'));
  initDrawer({ onProfilesChanged: refreshAll });

  await refreshAll();
  applyUrlOverridesAfterPayload();

  if (state.payload.profiles.length === 0) {
    openDrawer();
  }

  document.getElementById('scan-button').addEventListener('click', () => {
    if (isScanActive()) return;
    const visible = state.payload.profiles.filter((p) => !state.filter.hiddenProfiles.has(p.slug));
    if (visible.length === 0) {
      alert('Aucun profil visible.');
      return;
    }
    runScansSequentially(visible.map((p) => p.slug));
  });

  onMarkerClick((id) => {
    highlightRow(id);
    markRowAsRead(id);
    queueViewed(id);
  });
}

async function refreshAll() {
  const payload = await fetch('/api/map-listings').then((r) => r.json());
  state.payload = payload;

  for (const profile of payload.profiles) {
    setProfileVisibility(profile.slug, !state.filter.hiddenProfiles.has(profile.slug));
  }

  renderSidebar({ profiles: payload.profiles, sources: SOURCES }, state.filter, (next) => {
    state.filter = next;
    persistFilterState(next);
    rerender();
  });

  rerender();
}

function rerender() {
  const visible = applyFilters(state.payload.listings, state.filter, Date.now());
  setListings(visible);
  renderListings(visible, {
    onClick: (id) => focusListing(id, { openPopup: true }),
    onHover: () => {},
    onMarkViewed: async (ids) => {
      const groups = groupIdsByProfile(ids);
      await Promise.all([...groups.entries()].map(([profileSlug, groupIds]) =>
        fetch('/api/mark-viewed?profile=' + encodeURIComponent(profileSlug), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: groupIds })
        })
      ));
    }
  });

  for (const profile of state.payload.profiles) {
    setProfileVisibility(profile.slug, !state.filter.hiddenProfiles.has(profile.slug));
  }
}

function groupIdsByProfile(ids) {
  const idSet = new Set(ids);
  const groups = new Map();
  for (const listing of state.payload.listings) {
    if (!idSet.has(listing.id)) continue;
    if (!groups.has(listing.profileSlug)) groups.set(listing.profileSlug, []);
    groups.get(listing.profileSlug).push(listing.id);
  }
  return groups;
}

async function runScansSequentially(slugs) {
  for (const slug of slugs) {
    await new Promise((resolve) => {
      startScan(slug, {
        onListing: (listing) => {
          state.payload.listings = upsertListing(state.payload.listings, listing);
          addListing(listing, { animate: true });
        },
        onScanDone: () => { refreshAll().finally(resolve); },
        onScanError: () => resolve()
      });
    });
  }
}

function upsertListing(list, listing) {
  const idx = list.findIndex((l) => l.id === listing.id);
  if (idx === -1) return [...list, listing];
  const next = list.slice();
  next[idx] = { ...next[idx], ...listing };
  return next;
}

function hydrateFilterState() {
  const fromStorage = readJson(localStorage.getItem(STATE_KEY));
  const base = defaultFilterState();
  if (!fromStorage) return base;
  return {
    hiddenProfiles: new Set(fromStorage.hiddenProfiles || []),
    recent: fromStorage.recent || base.recent,
    unreadOnly: !!fromStorage.unreadOnly,
    statuses: new Set(fromStorage.statuses || [...base.statuses]),
    priorities: new Set(fromStorage.priorities || [...base.priorities]),
    sources: fromStorage.sources ? new Set(fromStorage.sources) : null
  };
}

function persistFilterState(s) {
  const serializable = {
    hiddenProfiles: [...s.hiddenProfiles],
    recent: s.recent,
    unreadOnly: s.unreadOnly,
    statuses: [...s.statuses],
    priorities: [...s.priorities],
    sources: s.sources ? [...s.sources] : null
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(serializable));
  syncUrl(s);
}

function syncUrl(s) {
  const params = new URLSearchParams(window.location.search);
  const visible = state.payload.profiles
    .map((p) => p.slug)
    .filter((slug) => !s.hiddenProfiles.has(slug));
  if (visible.length && visible.length < state.payload.profiles.length) {
    params.set('profiles', visible.join(','));
  } else {
    params.delete('profiles');
  }
  if (s.recent && s.recent !== 'any') params.set('recent', s.recent); else params.delete('recent');
  if (s.unreadOnly) params.set('unread', '1'); else params.delete('unread');

  const next = params.toString();
  const url = window.location.pathname + (next ? '?' + next : '');
  window.history.replaceState(null, '', url);
}

function applyUrlOverridesAfterPayload() {
  const params = new URLSearchParams(window.location.search);
  const profilesParam = params.get('profiles');
  if (profilesParam) {
    const requested = new Set(profilesParam.split(',').filter(Boolean));
    state.filter.hiddenProfiles = new Set(
      state.payload.profiles.map((p) => p.slug).filter((slug) => !requested.has(slug))
    );
  }
  const recent = params.get('recent');
  if (recent && ['1d', '3d', '7d', '14d'].includes(recent)) state.filter.recent = recent;
  if (params.get('unread') === '1') state.filter.unreadOnly = true;

  // Re-render with the merged state and resync the localStorage copy.
  persistFilterState(state.filter);
  rerender();
}

function readJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

bootstrap().catch((err) => {
  console.error('bootstrap failed', err);
  alert('Erreur au démarrage: ' + err.message);
});
```

- [ ] **Step 2: Smoke-test the full shell**

Run: `npm start`. Open `http://localhost:8787/`. Expected:
- Map loads centered on Switzerland.
- Sidebar lists each profile with eye toggles, the recent select, the unread toggle, status checkboxes (Sorting + Pursuing checked), priority checkboxes (all checked), source checkboxes (all checked).
- Right panel lists currently-visible listings.
- Clicking a profile's eye hides its pins and rows.
- Clicking the Settings button opens the drawer.
- Clicking Scanner with at least one profile visible opens the scan stream and pins drop.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app.js
git commit -m "feat(app): wire map shell entrypoint with sidebar/listings/scan/drawer"
```

---

### Task 20: Style the new shell

**Files:**
- Modify: `dashboard/styles.css`
- Possibly modify: `dashboard/components.css`

Replace `styles.css` contents with the styles for the new shell.

- [ ] **Step 1: Write the new styles**

Open `dashboard/styles.css` and replace its contents with rules covering:

- `.app-body` — `margin: 0; height: 100vh; overflow: hidden; font-family: var(--font-sans);`
- `.app-topbar` — flex row, height 48px, fixed, top of viewport
- `.app-shell` — CSS grid: `grid-template-columns: 280px 1fr 360px; height: calc(100vh - 48px);`
- `.app-sidebar` — overflow-y auto, padding, sections with subtle separators
- `.sidebar-section-head` — uppercase label
- `.app-map` — relative; full size
- `.map-canvas` — `position: absolute; inset: 0;`
- `.scan-progress` — absolute top center on the map; rounded card; thin animated bar at the bottom
- `.scan-progress.hidden` — `display: none`
- `.listings-rows` — overflow-y auto
- `.listing-row` — grid: thumb · body · side; `is-unread` adds a left accent using `--profile-color`
- `.listing-row.is-flash` — pulse animation
- `.drawer` — fixed inset 0; pointer events when not hidden
- `.drawer.hidden` — `display: none`
- `.drawer-overlay` — absolute fill, semi-transparent black
- `.drawer-panel` — left-aligned, 480px wide, full height, slides in
- `.map-marker-detail .pin` — drop-shape pin colored via `--pin-color`
- `.map-marker-dot .dot` — 8px circle
- `.map-marker-detail.marker-drop` — keyframe drop+pulse animation

Reference existing tokens in `tokens.css` (colors, spacing, radius, font sizes) wherever they fit. Avoid inventing new tokens unless an existing one is wrong.

- [ ] **Step 2: Smoke-test**

Reload the app. Verify the layout is correct: topbar fixed, three-column shell, scrollable sidebar, scrollable listings panel, fullscreen map, drawer slides in cleanly, scan-progress bar animates during a scan.

- [ ] **Step 3: Commit**

```bash
git add dashboard/styles.css dashboard/components.css
git commit -m "style(shell): rewrite styles.css for the map-centric shell"
```

---

## Phase 4 — Cleanup & docs

### Task 21: Delete the home page and the kanban code path

**Files:**
- Delete: `dashboard/home.html`, `dashboard/home.js`, `dashboard/home.css`

The home page is gone — `/` now serves the new shell. The kanban code lived inside the old `dashboard/app.js`, which has already been replaced. The Kanban-specific CSS in `components.css` and `styles.css` (if any survived the rewrite) gets pruned here.

- [ ] **Step 1: Delete the home files**

```bash
rm dashboard/home.html dashboard/home.js dashboard/home.css
```

- [ ] **Step 2: Audit for kanban leftovers**

Run: `grep -nE "kanban|Kanban|panel-kanban|tab-kanban" dashboard/ scripts/serve-dashboard.mjs`

Remove every match. In `components.css` and `styles.css` strip any rules under `.kanban-*` selectors. In `serve-dashboard.mjs` remove any references to `home.html`.

- [ ] **Step 3: Smoke-test**

Reload the app at `/`, click Settings, create/edit/delete a profile via the drawer (verify the lifted form actually works end-to-end). Visit `/oldslug/dashboard` and confirm the 302 still works.

- [ ] **Step 4: Commit**

```bash
git add -A dashboard/ scripts/serve-dashboard.mjs
git commit -m "refactor(cleanup): drop home page and kanban code path"
```

---

### Task 22: Update README and AGENTS docs

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update `README.md`**

Replace the "Dashboard", "First Run", "Usage", and "How It Works" sections so they describe:
- One route `/` serving a map-centric shell.
- Sidebar filters: profiles, recently found, unread, status (3 keys), priority, sources.
- Live scan with pin drops via SSE on `/api/run-scan-stream`.
- Status set is `sorting / pursuing / archived`. Mention the one-time migration from legacy French statuses.
- Settings drawer for profile CRUD.

- [ ] **Step 2: Update `AGENTS.md`**

Update the "Architecture", "Frontend Routes", "REST API", "Status Pipeline", and "Removed Listings" sections to reflect:
- `dashboard/index.html` is the only HTML; the home page is gone.
- New route `/api/run-scan-stream?profile=` (SSE).
- New route `POST /api/mark-viewed`.
- `POST /api/update-status` now accepts only `sorting | pursuing | archived`.
- `GET /api/map-listings` now exposes `status`, `priority`, `score`, `firstSeenAt`, `viewedAt` and no longer pre-filters by status.
- The 3-state status set replaces the 7-state French pipeline; `isRemoved` is gone.
- Tracker schema is at `schemaVersion: 2`; migration runs on `ensureProfileStorage()`.
- Old `/{slug}/dashboard` redirects to `/?profiles={slug}`.

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: describe the map-centric shell, SSE scan stream, and 3-state pipeline"
```

---

### Task 23: Add `.superpowers/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append the entry**

Edit `.gitignore` and add (under "OS / editor noise" or in its own section):

```
# Brainstorming session artifacts
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .superpowers/ brainstorm session artifacts"
```

---

## Final verification

Run the full test suite (one file at a time per the project's Node 22.15 quirk):

```bash
node --test tests/status.test.mjs
node --test tests/tracker-migration.test.mjs
node --test tests/mark-viewed.test.mjs
node --test tests/map-listings.test.mjs
node --test tests/map-utils.test.mjs
node --test tests/listing-filters.test.mjs
node --test tests/filter-logic.test.mjs
```

Expected: every file PASS, zero failures.

Manual end-to-end check:
- `/` loads the map shell with all profiles' pins.
- Hide a profile via the eye toggle — pins disappear.
- Toggle "Recently found · 3 days" — listings narrow.
- Toggle "Unread only" — only listings without `viewedAt` show.
- Click Status → uncheck Pursuing — those rows leave.
- Click Settings → create/edit/delete a profile — the map updates.
- Click Scanner — pins drop live, scan-progress bar animates, ends cleanly.
- `npm run scan -- --profile=<slug>` — runs unchanged with no SSE involvement.
