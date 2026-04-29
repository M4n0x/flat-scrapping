# Global Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a home-page global map showing all currently active displayed flats across all profiles, with per-profile pin colors, profile filters, low/high marker detail modes, and read-only popups.

**Architecture:** Add a small backend aggregation module that reads all profile trackers and geocode caches, then expose it through `GET /api/map-listings`. Persist listing map coordinates during scan and distance recomputation so the map endpoint never performs external geocoding. Add a `Carte globale` tab to the home page that uses Leaflet and the compact map API payload.

**Tech Stack:** Node.js 18+ ESM, native `node:test`, vanilla JS modules, Leaflet from CDN, OpenStreetMap tiles, JSON profile data under `data/profiles/`.

---

## File Structure

- Create `scripts/map-listings.mjs`: pure backend helpers for slug colors, listing address query construction, coordinate resolution from listing fields or cache, profile aggregation, and compact API payload creation.
- Create `tests/map-listings.test.mjs`: Node built-in tests for the backend aggregation rules.
- Modify `scripts/serve-dashboard.mjs`: import `buildMapListingsPayload()` and serve `GET /api/map-listings`.
- Modify `scripts/scrape-immobilier.mjs`: persist `mapLat`, `mapLon`, and `mapAddress` when distance geocoding succeeds, while preserving previous coordinates during merges.
- Modify `scripts/recompute-distances.mjs`: backfill the same coordinate fields during manual distance recomputation.
- Create `dashboard/map-utils.js`: browser-safe pure helpers for profile colors, money/room/surface labels, marker detail labels, and popup HTML.
- Create `tests/map-utils.test.mjs`: Node built-in tests for map UI formatting helpers.
- Modify `dashboard/home.html`: load Leaflet CSS/JS, add home tabs, wrap existing profile UI, and add map panel markup.
- Modify `dashboard/home.js`: add tab state, lazy map loading/rendering, profile filters, marker mode, popups, and scan-all refresh integration.
- Modify `dashboard/home.css`: style home tabs, map layout, profile filters, marker mode control, map status, Leaflet container, and custom marker icons.

---

### Task 1: Backend Map Aggregation Module

**Files:**
- Create: `scripts/map-listings.mjs`
- Create: `tests/map-listings.test.mjs`

- [ ] **Step 1: Write failing backend aggregation tests**

Create `tests/map-listings.test.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildListingAddressQuery,
  buildMapListingsPayload,
  profileColor,
  resolveListingCoordinates
} from '../scripts/map-listings.mjs';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

test('profileColor is stable and returns a hex color', () => {
  const first = profileColor('vevey');
  const second = profileColor('vevey');
  assert.equal(first, second);
  assert.match(first, /^#[0-9a-f]{6}$/i);
});

test('buildListingAddressQuery prefers listing address and appends Switzerland', () => {
  assert.equal(
    buildListingAddressQuery({ address: 'Rue du Lac 4, 1800 Vevey', area: 'Vevey' }),
    'Rue du Lac 4, 1800 Vevey, Suisse'
  );
  assert.equal(
    buildListingAddressQuery({ address: '', area: 'Fribourg' }),
    'Fribourg, Suisse'
  );
});

test('resolveListingCoordinates uses persisted map coordinates before cache', () => {
  const coords = resolveListingCoordinates(
    { mapLat: '46.46', mapLon: '6.84', address: 'Rue du Lac 4, 1800 Vevey' },
    { 'rue du lac 4, 1800 vevey, suisse': { lat: 1, lon: 2 } }
  );
  assert.deepEqual(coords, {
    lat: 46.46,
    lon: 6.84,
    address: 'Rue du Lac 4, 1800 Vevey'
  });
});

test('resolveListingCoordinates falls back to geocode cache address query', () => {
  const coords = resolveListingCoordinates(
    { address: 'Rue du Lac 4, 1800 Vevey', area: 'Vevey' },
    { 'rue du lac 4, 1800 vevey, suisse': { lat: 46.46, lon: 6.84 } }
  );
  assert.deepEqual(coords, {
    lat: 46.46,
    lon: 6.84,
    address: 'Rue du Lac 4, 1800 Vevey, Suisse'
  });
});

test('buildMapListingsPayload includes only active displayed non-refused listings with coordinates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apartment-map-'));
  const profilesDir = path.join(root, 'profiles');

  try {
    await writeJson(path.join(profilesDir, 'vevey', 'watch-config.json'), {
      shortTitle: 'Vevey',
      areas: [{ label: 'Vevey' }]
    });
    await writeJson(path.join(profilesDir, 'vevey', 'geocode-cache.json'), {
      'rue active 1, 1800 vevey, suisse': { lat: 46.46, lon: 6.84 }
    });
    await writeJson(path.join(profilesDir, 'vevey', 'tracker.json'), {
      listings: [
        {
          id: 'active',
          active: true,
          display: true,
          status: 'À contacter',
          title: 'Appartement actif',
          address: 'Rue Active 1, 1800 Vevey',
          area: 'Vevey',
          totalChf: 1450,
          rooms: 2.5,
          surfaceM2: 62,
          source: 'immobilier.ch',
          url: 'https://example.test/active'
        },
        {
          id: 'removed',
          active: false,
          display: true,
          isRemoved: true,
          address: 'Rue Removed 1, 1800 Vevey'
        },
        {
          id: 'refused',
          active: true,
          display: true,
          status: 'Refusé',
          mapLat: 46.47,
          mapLon: 6.85,
          address: 'Rue Refused 1, 1800 Vevey'
        },
        {
          id: 'missing-coords',
          active: true,
          display: true,
          status: 'À contacter',
          address: 'Rue Missing 1, 1800 Vevey'
        }
      ]
    });

    const payload = await buildMapListingsPayload(profilesDir);

    assert.equal(payload.profiles.length, 1);
    assert.equal(payload.profiles[0].slug, 'vevey');
    assert.equal(payload.profiles[0].totalActiveDisplayed, 2);
    assert.equal(payload.profiles[0].mappedCount, 1);
    assert.equal(payload.profiles[0].missingCoordinates, 1);
    assert.equal(payload.listings.length, 1);
    assert.equal(payload.listings[0].id, 'active');
    assert.equal(payload.listings[0].profileSlug, 'vevey');
    assert.equal(payload.listings[0].lat, 46.46);
    assert.equal(payload.listings[0].lon, 6.84);
    assert.deepEqual(payload.totals, {
      profiles: 1,
      activeDisplayed: 2,
      mapped: 1,
      missingCoordinates: 1
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/map-listings.test.mjs
```

Expected: FAIL with an import error for `../scripts/map-listings.mjs`.

- [ ] **Step 3: Implement backend map aggregation helpers**

Create `scripts/map-listings.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const PROFILE_COLORS = [
  '#56d4b8',
  '#8aa6ff',
  '#ffcf6e',
  '#e9788f',
  '#9ee66f',
  '#c58bff',
  '#66c7f4',
  '#ff9f6e',
  '#d6e16f',
  '#f27bd5'
];

export function profileColor(slug = '') {
  const text = String(slug || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return PROFILE_COLORS[hash % PROFILE_COLORS.length];
}

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeAddressPart(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bCH-\d{4}\b/gi, ' ')
    .replace(/\bVD\b/gi, ' ')
    .trim();
}

export function buildListingAddressQuery(item = {}) {
  const addressRaw = sanitizeAddressPart(item.address || '');
  const area = sanitizeAddressPart(item.area || '');

  if (addressRaw) return [addressRaw, 'Suisse'].filter(Boolean).join(', ');
  if (area) return [area, 'Suisse'].filter(Boolean).join(', ');
  return '';
}

function cachePoint(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = toNumberOrNull(value.lat);
  const lon = toNumberOrNull(value.lon);
  return lat == null || lon == null ? null : { lat, lon };
}

export function resolveListingCoordinates(item = {}, geocodeCache = {}) {
  const mapLat = toNumberOrNull(item.mapLat);
  const mapLon = toNumberOrNull(item.mapLon);
  if (mapLat != null && mapLon != null) {
    return {
      lat: mapLat,
      lon: mapLon,
      address: String(item.mapAddress || item.address || '').trim()
    };
  }

  const query = buildListingAddressQuery(item);
  if (!query) return null;

  const cached = cachePoint(geocodeCache[String(query).toLowerCase()]);
  if (!cached) return null;
  return { ...cached, address: query };
}

function isMapVisibleListing(item = {}) {
  return item.active !== false
    && item.display !== false
    && item.isRemoved !== true
    && String(item.status || '') !== 'Refusé';
}

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
    lat: coords.lat,
    lon: coords.lon
  };
}

export async function buildMapListingsPayload(profilesDir) {
  const profiles = [];
  const listings = [];
  const totals = {
    profiles: 0,
    activeDisplayed: 0,
    mapped: 0,
    missingCoordinates: 0
  };

  let entries = [];
  try {
    entries = await fs.readdir(profilesDir, { withFileTypes: true });
  } catch {
    return { generatedAt: new Date().toISOString(), profiles, listings, totals };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const profileDir = path.join(profilesDir, slug);
    const [config, tracker, geocodeCache] = await Promise.all([
      readJsonSafe(path.join(profileDir, 'watch-config.json'), null),
      readJsonSafe(path.join(profileDir, 'tracker.json'), { listings: [] }),
      readJsonSafe(path.join(profileDir, 'geocode-cache.json'), {})
    ]);

    if (!config || !Array.isArray(tracker.listings)) continue;

    const profile = {
      slug,
      title: config.shortTitle || config.name || slug,
      color: profileColor(slug),
      totalActiveDisplayed: 0,
      mappedCount: 0,
      missingCoordinates: 0
    };

    for (const item of tracker.listings) {
      if (!isMapVisibleListing(item)) continue;
      profile.totalActiveDisplayed += 1;

      const coords = resolveListingCoordinates(item, geocodeCache);
      if (!coords) {
        profile.missingCoordinates += 1;
        continue;
      }

      profile.mappedCount += 1;
      listings.push(compactListing(item, profile, coords));
    }

    profiles.push(profile);
    totals.profiles += 1;
    totals.activeDisplayed += profile.totalActiveDisplayed;
    totals.mapped += profile.mappedCount;
    totals.missingCoordinates += profile.missingCoordinates;
  }

  profiles.sort((a, b) => a.slug.localeCompare(b.slug));
  listings.sort((a, b) => a.profileSlug.localeCompare(b.profileSlug) || String(a.id).localeCompare(String(b.id)));

  return {
    generatedAt: new Date().toISOString(),
    profiles,
    listings,
    totals
  };
}
```

- [ ] **Step 4: Run backend aggregation tests**

Run:

```bash
node --test tests/map-listings.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit backend aggregation module**

Run:

```bash
git add scripts/map-listings.mjs tests/map-listings.test.mjs
git commit -m "feat: add global map aggregation helpers"
```

---

### Task 2: Serve Map API Endpoint

**Files:**
- Modify: `scripts/serve-dashboard.mjs`

- [ ] **Step 1: Add the API import**

At the top of `scripts/serve-dashboard.mjs`, after the existing imports, add:

```js
import { buildMapListingsPayload } from './map-listings.mjs';
```

- [ ] **Step 2: Add the route before `/api/profile/detail`**

In `scripts/serve-dashboard.mjs`, after the existing `/api/profiles` route and before `/api/profile/detail`, add:

```js
  if (req.method === 'GET' && u.pathname === '/api/map-listings') {
    const payload = await buildMapListingsPayload(PROFILES_DATA_DIR);
    return sendJson(res, 200, payload);
  }
```

- [ ] **Step 3: Syntax-check the server script**

Run:

```bash
node --check scripts/serve-dashboard.mjs
```

Expected: no output and exit code 0.

- [ ] **Step 4: Run backend map tests again**

Run:

```bash
node --test tests/map-listings.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit API route**

Run:

```bash
git add scripts/serve-dashboard.mjs
git commit -m "feat: expose global map listings api"
```

---

### Task 3: Persist Map Coordinates During Scans

**Files:**
- Modify: `scripts/scrape-immobilier.mjs`
- Modify: `scripts/recompute-distances.mjs`

- [ ] **Step 1: Add a small coordinate copy helper in the scraper**

In `scripts/scrape-immobilier.mjs`, after `computeDistanceFromWork()`, add:

```js
function applyMapCoordinatesFromDistance(item, distanceMeta) {
  const lat = Number(distanceMeta?.listingCoords?.lat);
  const lon = Number(distanceMeta?.listingCoords?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  item.mapLat = lat;
  item.mapLon = lon;
  item.mapAddress = distanceMeta.listingAddress || buildListingAddressQuery(item);
}
```

- [ ] **Step 2: Persist coordinates when a displayed current listing is geocoded**

In the block where current displayed listings compute distance:

```js
      const distanceMeta = await computeDistanceFromWork(item, workCoords, geocodeCache);
      item.distanceKm = distanceMeta.distanceKm;
      item.distanceText = distanceMeta.distanceText;
      item.distanceComputed = distanceMeta.computed;
      item.distanceFromWorkAddress = workAddress;
```

change it to:

```js
      const distanceMeta = await computeDistanceFromWork(item, workCoords, geocodeCache);
      item.distanceKm = distanceMeta.distanceKm;
      item.distanceText = distanceMeta.distanceText;
      item.distanceComputed = distanceMeta.computed;
      item.distanceFromWorkAddress = workAddress;
      applyMapCoordinatesFromDistance(item, distanceMeta);
```

- [ ] **Step 3: Preserve previous coordinates when merging existing listings**

In the existing-listing `merged.push({ ...existing, ...item, ... })` block, add these properties after `transitText`:

```js
        mapLat: item.mapLat ?? existing.mapLat ?? null,
        mapLon: item.mapLon ?? existing.mapLon ?? null,
        mapAddress: item.mapAddress || existing.mapAddress || '',
```

- [ ] **Step 4: Persist coordinates for new listings**

In the new-listing `merged.push({ ...item, ... })` block, add these properties after `transitText`:

```js
        mapLat: item.mapLat ?? null,
        mapLon: item.mapLon ?? null,
        mapAddress: item.mapAddress || '',
```

- [ ] **Step 5: Backfill coordinates in old missing-listing recomputation**

In the old-listing recomputation block:

```js
        if (distanceMeta.computed) {
          distanceKm = distanceMeta.distanceKm;
          distanceText = distanceMeta.distanceText;
```

change it to:

```js
        if (distanceMeta.computed) {
          distanceKm = distanceMeta.distanceKm;
          distanceText = distanceMeta.distanceText;
          applyMapCoordinatesFromDistance(old, distanceMeta);
```

Then in the following `merged.push({ ...old, ...refreshed, ... })`, add after `transitText`:

```js
        mapLat: old.mapLat ?? null,
        mapLon: old.mapLon ?? null,
        mapAddress: old.mapAddress || '',
```

- [ ] **Step 6: Add coordinate persistence to recompute-distances**

In `scripts/recompute-distances.mjs`, after:

```js
    listing.distanceComputed = true;
    listing.distanceFromWorkAddress = workAddress;
```

add:

```js
    listing.mapLat = listingCoords.lat;
    listing.mapLon = listingCoords.lon;
    listing.mapAddress = addr + ', Suisse';
```

- [ ] **Step 7: Syntax-check changed scripts**

Run:

```bash
node --check scripts/scrape-immobilier.mjs
node --check scripts/recompute-distances.mjs
```

Expected: both commands produce no output and exit code 0.

- [ ] **Step 8: Run backend map tests**

Run:

```bash
node --test tests/map-listings.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit coordinate persistence**

Run:

```bash
git add scripts/scrape-immobilier.mjs scripts/recompute-distances.mjs
git commit -m "feat: persist map coordinates for listings"
```

---

### Task 4: Frontend Map Formatting Utilities

**Files:**
- Create: `dashboard/map-utils.js`
- Create: `tests/map-utils.test.mjs`

- [ ] **Step 1: Write failing frontend utility tests**

Create `tests/map-utils.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  formatMarkerDetails,
  moneyLabel,
  popupHtml,
  profileColor,
  roomsLabel,
  surfaceLabel
} from '../dashboard/map-utils.js';

test('profileColor is stable and hex formatted', () => {
  assert.equal(profileColor('fribourg'), profileColor('fribourg'));
  assert.match(profileColor('fribourg'), /^#[0-9a-f]{6}$/i);
});

test('labels format missing values compactly', () => {
  assert.equal(moneyLabel(null), 'CHF -');
  assert.equal(roomsLabel(null), '- p');
  assert.equal(surfaceLabel(null), '- m2');
});

test('formatMarkerDetails combines price rooms and surface', () => {
  assert.equal(
    formatMarkerDetails({ totalChf: 1450, rooms: 2.5, surfaceM2: 62 }),
    "CHF 1'450 · 2.5 p · 62 m2"
  );
});

test('popupHtml escapes listing content and keeps safe link attributes', () => {
  const html = popupHtml({
    profileTitle: '<Profile>',
    title: '<Flat>',
    address: 'Rue & Lac',
    area: 'Vevey',
    totalChf: 1450,
    rooms: 2.5,
    surfaceM2: 62,
    source: 'immobilier.ch',
    url: 'https://example.test/listing'
  });

  assert.match(html, /&lt;Profile&gt;/);
  assert.match(html, /&lt;Flat&gt;/);
  assert.match(html, /Rue &amp; Lac/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer"/);
});

test('escapeHtml handles quotes', () => {
  assert.equal(escapeHtml(`"A&B"`), '&quot;A&amp;B&quot;');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/map-utils.test.mjs
```

Expected: FAIL with an import error for `../dashboard/map-utils.js`.

- [ ] **Step 3: Implement frontend utility module**

Create `dashboard/map-utils.js`:

```js
const PROFILE_COLORS = [
  '#56d4b8',
  '#8aa6ff',
  '#ffcf6e',
  '#e9788f',
  '#9ee66f',
  '#c58bff',
  '#66c7f4',
  '#ff9f6e',
  '#d6e16f',
  '#f27bd5'
];

export function profileColor(slug = '') {
  const text = String(slug || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return PROFILE_COLORS[hash % PROFILE_COLORS.length];
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function moneyLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'CHF -';
  return `CHF ${new Intl.NumberFormat('fr-CH').format(n)}`;
}

export function roomsLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '- p';
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)} p`;
}

export function surfaceLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '- m2';
  return `${Math.round(n)} m2`;
}

export function formatMarkerDetails(item = {}) {
  return `${moneyLabel(item.totalChf)} · ${roomsLabel(item.rooms)} · ${surfaceLabel(item.surfaceM2)}`;
}

export function popupHtml(item = {}) {
  const title = item.title || item.address || 'Annonce';
  const meta = [
    moneyLabel(item.totalChf),
    roomsLabel(item.rooms),
    surfaceLabel(item.surfaceM2)
  ].join(' · ');

  const source = item.source ? `<div class="map-popup-muted">${escapeHtml(item.source)}</div>` : '';
  const area = item.area ? `<div class="map-popup-muted">${escapeHtml(item.area)}</div>` : '';
  const address = item.address ? `<div>${escapeHtml(item.address)}</div>` : '';
  const link = item.url
    ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Ouvrir l'annonce</a>`
    : '';

  return `
    <div class="map-popup">
      <div class="map-popup-profile">${escapeHtml(item.profileTitle || item.profileSlug || '')}</div>
      <strong>${escapeHtml(title)}</strong>
      ${address}
      ${area}
      <div>${escapeHtml(meta)}</div>
      ${source}
      ${link}
    </div>
  `;
}
```

- [ ] **Step 4: Run frontend utility tests**

Run:

```bash
node --test tests/map-utils.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit frontend utilities**

Run:

```bash
git add dashboard/map-utils.js tests/map-utils.test.mjs
git commit -m "feat: add map frontend utilities"
```

---

### Task 5: Home Page Map Markup and Styles

**Files:**
- Modify: `dashboard/home.html`
- Modify: `dashboard/home.css`
- Modify: `scripts/serve-dashboard.mjs`

- [ ] **Step 1: Add Leaflet assets to the home page**

In `dashboard/home.html`, add this after the viewport meta tag:

```html
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
```

At the bottom, before the existing `home.js` module script, add:

```html
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
```

- [ ] **Step 2: Wrap existing content in home tabs**

In `dashboard/home.html`, insert this tab nav immediately after the `scan-all-progress` div:

```html
      <nav class="home-tabs" aria-label="Navigation accueil">
        <button id="home-tab-profiles" class="home-tab active" type="button" data-home-view="profiles">Profils</button>
        <button id="home-tab-map" class="home-tab" type="button" data-home-view="map">Carte globale</button>
      </nav>
```

Insert this opening wrapper immediately before the existing `<section id="profiles-grid" class="profiles-grid">`:

```html
      <section id="home-panel-profiles" class="home-panel active">
```

Insert this closing wrapper immediately after the existing `</section>` that closes `<section id="create-section" class="create-section hidden">`:

```html
      </section>
```

Then insert this map panel immediately after that closing wrapper:

```html
      <section id="home-panel-map" class="home-panel">
        <div class="global-map-shell">
          <aside class="global-map-controls">
            <div class="map-control-head">
              <h2>Carte globale</h2>
              <button id="map-refresh" class="btn ghost" type="button">Rafraîchir</button>
            </div>
            <div class="map-mode-toggle" role="group" aria-label="Détail des pins">
              <button id="map-mode-points" class="map-mode active" type="button" data-map-mode="points">Points</button>
              <button id="map-mode-details" class="map-mode" type="button" data-map-mode="details">Détails</button>
            </div>
            <div id="map-profile-filters" class="map-profile-filters"></div>
            <p id="map-status" class="map-status">Chargement…</p>
          </aside>
          <section class="global-map-panel">
            <div id="global-map" class="global-map" aria-label="Carte des annonces"></div>
            <div id="map-empty" class="map-empty hidden"></div>
          </section>
        </div>
      </section>
```

- [ ] **Step 3: Serve the new browser utility module under profile asset routes**

In `scripts/serve-dashboard.mjs`, update the profile asset route regex:

```js
  const profileAssetMatch = u.pathname.match(/^\/([a-z0-9-]+)\/(app\.js|styles\.css|map-utils\.js)$/i);
```

This keeps module serving consistent if a profile-scoped route ever imports the map utilities.

- [ ] **Step 4: Add map CSS**

Append to `dashboard/home.css`:

```css
.home-tabs {
  display: inline-flex;
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(8, 24, 33, 0.8);
  margin-bottom: 18px;
}

.home-tab {
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  padding: 8px 14px;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
}

.home-tab.active {
  color: #06271e;
  background: linear-gradient(125deg, #5ce0bf, #9df0c0);
}

.home-panel {
  display: none;
}

.home-panel.active {
  display: block;
}

.global-map-shell {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  gap: 14px;
  min-height: 620px;
}

.global-map-controls,
.global-map-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow);
}

.global-map-controls {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.map-control-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.map-control-head h2 {
  font-size: 1.1rem;
}

.map-mode-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(8, 24, 33, 0.72);
}

.map-mode {
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  padding: 7px 10px;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.map-mode.active {
  color: #06271e;
  background: var(--primary);
}

.map-profile-filters {
  display: grid;
  gap: 8px;
}

.map-profile-filter {
  display: grid;
  grid-template-columns: auto 12px 1fr auto;
  gap: 8px;
  align-items: center;
  color: var(--text);
  font-size: 0.84rem;
}

.map-profile-filter input {
  margin: 0;
}

.map-profile-swatch {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.75);
}

.map-profile-count {
  color: var(--muted);
  font-size: 0.76rem;
}

.map-status {
  margin: auto 0 0;
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.4;
}

.global-map-panel {
  position: relative;
  overflow: hidden;
  min-height: 620px;
}

.global-map {
  min-height: 620px;
  height: min(72vh, 760px);
  background: #10232c;
}

.map-empty {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 450;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(7, 23, 32, 0.92);
  color: var(--muted);
  padding: 12px 14px;
  font-size: 0.86rem;
}

.map-dot-marker {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

.map-detail-marker {
  border: 2px solid white;
  border-radius: 999px;
  color: #051c17;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
  padding: 5px 8px;
  white-space: nowrap;
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.32);
}

.map-popup {
  display: grid;
  gap: 4px;
  color: #102129;
  min-width: 190px;
}

.map-popup-profile,
.map-popup-muted {
  color: #49616a;
  font-size: 0.78rem;
}

@media (max-width: 760px) {
  .global-map-shell {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .global-map,
  .global-map-panel {
    min-height: 480px;
  }
}
```

- [ ] **Step 5: Syntax-check changed scripts**

Run:

```bash
node --check scripts/serve-dashboard.mjs
```

Expected: no output and exit code 0.

- [ ] **Step 6: Commit markup and styles**

Run:

```bash
git add dashboard/home.html dashboard/home.css scripts/serve-dashboard.mjs
git commit -m "feat: add global map home tab layout"
```

---

### Task 6: Home Page Map Behavior

**Files:**
- Modify: `dashboard/home.js`

- [ ] **Step 1: Import map utility helpers**

At the top of `dashboard/home.js`, before DOM lookups, add:

```js
import { formatMarkerDetails, popupHtml } from './map-utils.js';
```

- [ ] **Step 2: Add map DOM lookups and state**

After the existing top-level DOM constants, add:

```js
const homeTabProfilesEl = document.getElementById('home-tab-profiles');
const homeTabMapEl = document.getElementById('home-tab-map');
const homePanelProfilesEl = document.getElementById('home-panel-profiles');
const homePanelMapEl = document.getElementById('home-panel-map');
const mapRefreshBtn = document.getElementById('map-refresh');
const mapProfileFiltersEl = document.getElementById('map-profile-filters');
const mapStatusEl = document.getElementById('map-status');
const mapEmptyEl = document.getElementById('map-empty');
const mapModePointsEl = document.getElementById('map-mode-points');
const mapModeDetailsEl = document.getElementById('map-mode-details');

const HOME_VIEW_STORAGE_KEY = 'apartment-home:view';
const MAP_MODE_STORAGE_KEY = 'apartment-map:mode';
const MAP_VISIBLE_PROFILES_KEY = 'apartment-map:visible-profiles';

let mapInstance = null;
let mapLayer = null;
let mapPayload = null;
let mapLoaded = false;
let mapMode = localStorage.getItem(MAP_MODE_STORAGE_KEY) === 'details' ? 'details' : 'points';
let visibleProfileSlugs = new Set();
```

- [ ] **Step 3: Add home tab switching**

After the existing `hideForm()` function, add:

```js
function setHomeView(view, persist = true) {
  const mapActive = view === 'map';
  homeTabProfilesEl?.classList.toggle('active', !mapActive);
  homeTabMapEl?.classList.toggle('active', mapActive);
  homePanelProfilesEl?.classList.toggle('active', !mapActive);
  homePanelMapEl?.classList.toggle('active', mapActive);

  if (persist) localStorage.setItem(HOME_VIEW_STORAGE_KEY, mapActive ? 'map' : 'profiles');
  if (mapActive) {
    ensureMapLoaded();
    setTimeout(() => mapInstance?.invalidateSize(), 0);
  }
}

homeTabProfilesEl?.addEventListener('click', () => setHomeView('profiles'));
homeTabMapEl?.addEventListener('click', () => setHomeView('map'));
```

- [ ] **Step 4: Add map loading and rendering functions**

After `loadProfiles()` and before the scan-all section, add:

```js
function loadVisibleProfileSlugs(profiles) {
  const saved = localStorage.getItem(MAP_VISIBLE_PROFILES_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return new Set(parsed);
    } catch {
      return new Set(profiles.map((p) => p.slug));
    }
  }
  return new Set(profiles.map((p) => p.slug));
}

function saveVisibleProfileSlugs() {
  localStorage.setItem(MAP_VISIBLE_PROFILES_KEY, JSON.stringify([...visibleProfileSlugs]));
}

function setMapMode(nextMode) {
  mapMode = nextMode === 'details' ? 'details' : 'points';
  localStorage.setItem(MAP_MODE_STORAGE_KEY, mapMode);
  mapModePointsEl?.classList.toggle('active', mapMode === 'points');
  mapModeDetailsEl?.classList.toggle('active', mapMode === 'details');
  renderMapMarkers(false);
}

function ensureLeaflet() {
  return window.L && typeof window.L.map === 'function';
}

function ensureMapInstance() {
  if (mapInstance) return true;
  if (!ensureLeaflet()) {
    mapStatusEl.textContent = 'Impossible de charger la carte. Vérifiez la connexion réseau.';
    return false;
  }

  mapInstance = window.L.map('global-map', {
    scrollWheelZoom: true
  }).setView([46.8, 8.2], 8);

  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(mapInstance);

  mapLayer = window.L.layerGroup().addTo(mapInstance);
  return true;
}

function createMapIcon(item) {
  const color = item.profileColor || '#56d4b8';
  if (mapMode === 'details') {
    const html = `<div class="map-detail-marker" style="background:${escapeHtml(color)}">${escapeHtml(formatMarkerDetails(item))}</div>`;
    return window.L.divIcon({
      className: 'map-marker-wrap',
      html,
      iconSize: null,
      iconAnchor: [18, 16],
      popupAnchor: [0, -14]
    });
  }

  return window.L.divIcon({
    className: 'map-marker-wrap',
    html: `<div class="map-dot-marker" style="background:${escapeHtml(color)}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9]
  });
}

function renderMapFilters() {
  if (!mapPayload) return;
  mapProfileFiltersEl.innerHTML = '';

  for (const profile of mapPayload.profiles) {
    const label = document.createElement('label');
    label.className = 'map-profile-filter';
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(profile.slug)}" ${visibleProfileSlugs.has(profile.slug) ? 'checked' : ''} />
      <span class="map-profile-swatch" style="background:${escapeHtml(profile.color)}"></span>
      <span>${escapeHtml(profile.title)}</span>
      <span class="map-profile-count">${profile.mappedCount}/${profile.totalActiveDisplayed}</span>
    `;

    label.querySelector('input').addEventListener('change', (event) => {
      if (event.currentTarget.checked) visibleProfileSlugs.add(profile.slug);
      else visibleProfileSlugs.delete(profile.slug);
      saveVisibleProfileSlugs();
      renderMapMarkers(true);
    });

    mapProfileFiltersEl.appendChild(label);
  }
}

function renderMapMarkers(fitBounds = true) {
  if (!mapPayload || !ensureMapInstance()) return;

  mapLayer.clearLayers();
  const visible = mapPayload.listings.filter((item) => visibleProfileSlugs.has(item.profileSlug));
  const bounds = [];

  for (const item of visible) {
    const marker = window.L.marker([item.lat, item.lon], { icon: createMapIcon(item) });
    marker.bindPopup(popupHtml(item));
    marker.addTo(mapLayer);
    bounds.push([item.lat, item.lon]);
  }

  const totalVisible = visible.length;
  const missing = mapPayload.profiles
    .filter((p) => visibleProfileSlugs.has(p.slug))
    .reduce((sum, p) => sum + Number(p.missingCoordinates || 0), 0);

  mapStatusEl.textContent = `${totalVisible} annonces visibles sur la carte · ${missing} sans coordonnées`;

  if (mapEmptyEl) {
    if (!totalVisible) {
      mapEmptyEl.textContent = mapPayload.totals.activeDisplayed > 0
        ? 'Aucune annonce avec coordonnées pour les profils sélectionnés. Les coordonnées seront complétées après le prochain scan ou recalcul des distances.'
        : 'Aucune annonce active à afficher.';
      mapEmptyEl.classList.remove('hidden');
    } else {
      mapEmptyEl.classList.add('hidden');
    }
  }

  if (fitBounds && bounds.length) {
    mapInstance.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
  }
}

async function loadMapData() {
  if (!mapStatusEl) return;
  mapStatusEl.textContent = 'Chargement de la carte…';
  try {
    const res = await fetch('/api/map-listings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mapPayload = await res.json();
    visibleProfileSlugs = loadVisibleProfileSlugs(mapPayload.profiles || []);
    renderMapFilters();
    ensureMapInstance();
    renderMapMarkers(true);
    mapLoaded = true;
  } catch (err) {
    mapStatusEl.innerHTML = `Erreur carte: ${escapeHtml(err.message)} <button id="map-retry" class="save-inline" type="button">Réessayer</button>`;
    document.getElementById('map-retry')?.addEventListener('click', loadMapData);
  }
}

function ensureMapLoaded() {
  if (mapLoaded) {
    setTimeout(() => mapInstance?.invalidateSize(), 0);
    return;
  }
  loadMapData();
}

mapRefreshBtn?.addEventListener('click', loadMapData);
mapModePointsEl?.addEventListener('click', () => setMapMode('points'));
mapModeDetailsEl?.addEventListener('click', () => setMapMode('details'));
setMapMode(mapMode);
```

- [ ] **Step 5: Refresh map data after scan-all finishes**

In `pollScanJob()`, inside the `if (job.status === 'done')` block after `await loadProfiles();`, add:

```js
        if (mapLoaded) await loadMapData();
```

- [ ] **Step 6: Restore saved home tab on load**

At the bottom, replace:

```js
loadProfiles().then(() => resumeScanIfNeeded());
```

with:

```js
loadProfiles().then(() => {
  const savedHomeView = localStorage.getItem(HOME_VIEW_STORAGE_KEY);
  setHomeView(savedHomeView === 'map' ? 'map' : 'profiles', false);
  resumeScanIfNeeded();
});
```

- [ ] **Step 7: Syntax-check frontend modules**

Run:

```bash
node --check dashboard/home.js
node --check dashboard/map-utils.js
```

Expected: both commands produce no output and exit code 0.

- [ ] **Step 8: Run all Node tests**

Run:

```bash
node --test tests/map-listings.test.mjs tests/map-utils.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit map behavior**

Run:

```bash
git add dashboard/home.js
git commit -m "feat: render global map on home page"
```

---

### Task 7: End-to-End Verification

**Files:**
- No source files expected unless verification finds a defect.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check scripts/serve-dashboard.mjs
node --check scripts/scrape-immobilier.mjs
node --check scripts/recompute-distances.mjs
node --check dashboard/home.js
node --check dashboard/map-utils.js
```

Expected: every command exits 0 with no output.

- [ ] **Step 2: Run tests**

Run:

```bash
node --test tests/map-listings.test.mjs tests/map-utils.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Start the dashboard**

Run:

```bash
PORT=8787 npm start
```

Expected: server logs `Dashboard local prêt: http://localhost:8787/`.

- [ ] **Step 4: Browser manual verification**

Open `http://localhost:8787/` and verify:

- `Profils` tab shows existing profile cards.
- `Carte globale` tab shows the Leaflet map.
- Profile filter checkboxes hide and show markers.
- `Points` mode shows dot markers.
- `Détails` mode shows labels containing price, rooms, and surface.
- Marker popups show profile, title/address, price, rooms, size, source, and listing link.
- Scan-all completion refreshes map data when the map has already been opened.

- [ ] **Step 5: Commit verification fixes only if needed**

If Step 4 finds a concrete defect, fix the smallest related source change and run:

```bash
git add dashboard/home.html dashboard/home.js dashboard/home.css dashboard/map-utils.js scripts/serve-dashboard.mjs scripts/scrape-immobilier.mjs scripts/recompute-distances.mjs tests/map-listings.test.mjs tests/map-utils.test.mjs
git commit -m "fix: polish global map behavior"
```

If no defect is found, do not create a verification-only commit.
