# MapLibre 3D Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Leaflet 1.9.4 with MapLibre GL JS 4.x in the dashboard, enabling true 3D (terrain, pitch, sky, building extrusions) while keeping `dashboard/map.js`'s public API and downstream consumers unchanged.

**Architecture:** Rewrite `dashboard/map.js` internals against the MapLibre GL API while preserving every named export (19 functions used by `app.js`). The base map uses swisstopo's free vector tile style (Switzerland-focused, no API key) with AWS Open Terrain Tiles (terrarium-encoded) as the DEM source for 3D terrain. Listing markers stay as DOM elements via `maplibregl.Marker(htmlElement)` so the existing `.map-marker-dot` / `.map-marker-detailed` CSS keeps working. Commune polygons move from `L.geoJSON` layers to a single GeoJSON source + `fill` layer with feature-state for hover/selection. The lasso uses a small custom canvas overlay rather than pulling in `maplibre-gl-draw` (~50 KB).

**Tech Stack:** MapLibre GL JS 4.x (CDN), swisstopo vector tiles (`leichte-basiskarte.vt`), AWS Open Terrain Tiles (DEM), swisstopo `api3.geo.admin.ch` identify/search (unchanged), vanilla ESM (no build step).

---

## Decisions Locked Before Implementation

- **Tile style:** `https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte.vt/style.json` — free, no key, Swiss-focused, ships with hillshade-friendly land cover. Fallback if it fails to load: `https://tiles.openfreemap.org/styles/liberty`.
- **Terrain DEM:** AWS Open Terrain Tiles (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, encoding `terrarium`, max zoom 15) — free, no key, global. MapLibre supports terrarium natively.
- **Default 3D state:** pitch 0°, bearing 0°, max-pitch 75°. Terrain enabled at exaggeration 1.4 (mountains read clearly without breaking flat-land map UX).
- **Marker strategy:** keep existing markup; render via `new maplibregl.Marker({ element, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport' })`. This makes pins behave identically at any pitch/bearing — no skew.
- **Marker DOM construction:** all marker DOM is built via `document.createElement` + `textContent` (no `innerHTML`). The Leaflet build used `divIcon({ html })` strings; the migration upgrades to safe DOM construction without changing visual output.
- **Edit polygons:** single `geojson` source `'edit-zones'` + two layers (`'edit-zones-fill'`, `'edit-zones-outline'`). Hover/selection uses `feature-state`, not style swaps.
- **Lasso:** custom transparent `<canvas>` overlay positioned over the map container during draw mode. Avoids extra dep and keeps pixel coordinates trivial via `map.project(lngLat)`.
- **Public API preservation:** every export currently consumed by `dashboard/app.js` (19 functions) keeps the same name, signature, and observable behavior. **No changes to `app.js`, `profile-edit.js`, `listing-detail.js`, or any other file outside the map seam.**

## File Structure

- **Modify:** `dashboard/index.html` — swap Leaflet CDN tags for MapLibre.
- **Rewrite:** `dashboard/map.js` (~660 lines → ~700 lines new). Same exports, MapLibre internals.
- **Modify:** `dashboard/styles.css` — remove `.leaflet-*` selectors (lines ~941–946, 1183–1190, 1276–1277), add equivalents for `.maplibregl-canvas-container.lasso-armed` etc., add `#map .maplibregl-ctrl-attrib` styling. **Keep all `.map-marker-dot`, `.map-marker-detailed`, `.dot`, `.mp-card`, `.mp-tail`, `.mp-price`, `.mp-meta`, `.is-selected`, `.marker-drop` rules unchanged** — they apply to inner DOM that MapLibre wraps.
- **No changes:** `dashboard/app.js`, `dashboard/profile-edit.js`, `dashboard/listing-detail.js`, `dashboard/filter-panels.js`, `dashboard/listings-panel.js`, `dashboard/scan.js`, `dashboard/components.css`, `dashboard/tokens.css`, `dashboard/map-utils.js`, anything in `scripts/` or `tests/`.

## Verification Posture

There is no UI test framework in this repo (`tests/*.test.mjs` covers node-side scrape/filter logic only). Each task ends with a **manual browser checklist** the engineer must execute against `npm start` (which serves `dashboard/` via `scripts/serve-dashboard.mjs`). DevTools must be open with the Console tab visible — any red error fails the task. Phase 1 (2D parity) must pass before Phase 2 (3D activation) begins; otherwise 3D bugs and migration bugs become indistinguishable.

---

## Phase 1 — 2D Parity (no 3D yet)

The goal of Phase 1 is byte-for-byte UX parity with the current Leaflet build, on a MapLibre engine, in flat 2D mode. 3D capability is wired but intentionally not activated until Phase 2.

### Task 1: Swap CDN, scaffold base 2D map

**Files:**
- Modify: `dashboard/index.html:15` (Leaflet CSS link)
- Modify: `dashboard/index.html:133` (Leaflet JS script)
- Rewrite: `dashboard/map.js` (full file replacement — see steps below)

- [ ] **Step 1: Replace Leaflet CDN tags with MapLibre**

In `dashboard/index.html`, replace the Leaflet CSS link (line 15):

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" crossorigin="anonymous" referrerpolicy="no-referrer" />
```

Replace the Leaflet JS script (line 133):

```html
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
```

- [ ] **Step 2: Stash the current `dashboard/map.js` for reference**

```bash
cp dashboard/map.js dashboard/map.leaflet.bak.js
```

This file is untracked, lives next to the new one for the duration of the migration, and gets deleted in Task 5. It exists so the engineer can diff behaviors when MapLibre and Leaflet implementations diverge mid-migration.

- [ ] **Step 3: Replace `dashboard/map.js` with the Phase-1 scaffold (base map only)**

Overwrite `dashboard/map.js` with the following. This file exports every name `app.js` imports — most are stubs that will be filled in by later tasks. Stubs must exist from Task 1 onward or `app.js` import-time evaluation throws.

```js
// MapLibre map: base render, pins, edit-mode commune polygons, lasso draw.
// Public API mirrors the previous Leaflet implementation 1:1; app.js is unchanged.

const SWITZERLAND_VIEW = { center: [8.2275, 46.8182], zoom: 7.2 }; // [lng, lat] for MapLibre
const STYLE_URL = 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte.vt/style.json';
const COMMUNE_LAYER = 'ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill';
const COMMUNE_TIME_INSTANT = 2024;
const LASSO_MIN_POINTS = 6;
const LASSO_MIN_PIXELS = 12;

const CANTON_MAP = {
  ag: 'aargau', ai: 'appenzell-innerrhoden', ar: 'appenzell-ausserrhoden',
  be: 'bern', bl: 'basel-landschaft', bs: 'basel-stadt',
  fr: 'fribourg', ge: 'geneve', gl: 'glarus', gr: 'graubunden',
  ju: 'jura', lu: 'luzern', ne: 'neuchatel', nw: 'nidwalden',
  ow: 'obwalden', sg: 'st-gallen', sh: 'schaffhausen', so: 'solothurn',
  sz: 'schwyz', tg: 'thurgau', ti: 'ticino', ur: 'uri',
  vd: 'vaud', vs: 'valais', zg: 'zug', zh: 'zurich'
};

const PIN_MODE_KEY = 'apartment-ops:pin-mode:v1';

let map = null;
let mapReady = false;
const readyQueue = []; // functions to run once style+sources are loaded

const markersById = new Map();          // id -> { marker, listing }
const profileVisibility = new Map();    // slug -> boolean
let listingClickHandler = () => {};
let listingHoverHandler = () => {};
let mapClickHandler = null;
let pinMode = readPinMode();

// Edit-mode state — populated in Task 3
let editState = null;
const polygonCache = new Map();         // bfsKey -> GeoJSON geometry
const selectedZones = new Map();        // bfsKey -> zone (also acts as feature-id source)
const slugToBfs = new Map();

// Lasso state — populated in Task 4
let lassoActive = false;
let lassoStateChangeHandler = null;

function readPinMode() {
  try { return localStorage.getItem(PIN_MODE_KEY) === 'detailed' ? 'detailed' : 'compact'; }
  catch { return 'compact'; }
}

function whenReady(fn) {
  if (mapReady) fn();
  else readyQueue.push(fn);
}

export function initMap(container) {
  if (map) return { map };
  map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: SWITZERLAND_VIEW.center,
    zoom: SWITZERLAND_VIEW.zoom,
    attributionControl: { compact: true },
    maxPitch: 75,
    pitch: 0,
    bearing: 0,
    hash: false,
    cooperativeGestures: false
  });

  map.on('load', () => {
    mapReady = true;
    while (readyQueue.length) readyQueue.shift()();
  });

  map.on('click', (e) => {
    // Background-click handler fires only if no marker/feature consumed the event.
    if (mapClickHandler) mapClickHandler({ latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng } });
  });

  bindZoomButtons();
  return { map };
}

function bindZoomButtons() {
  const inBtn = document.getElementById('zoom-in');
  const outBtn = document.getElementById('zoom-out');
  if (inBtn) inBtn.addEventListener('click', () => map.zoomIn());
  if (outBtn) outBtn.addEventListener('click', () => map.zoomOut());
}

export function getMap() { return map; }

export function onMapBackgroundClick(handler) {
  mapClickHandler = typeof handler === 'function' ? handler : null;
}

export function fitMapToPoints(points, { padding = 60, singleZoom = 12, maxZoom = 14 } = {}) {
  if (!map || !Array.isArray(points) || points.length === 0) return;
  // Leaflet API received [lat, lon]; preserve that contract for callers.
  const valid = points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (valid.length === 0) return;
  if (valid.length === 1) {
    map.flyTo({ center: [valid[0][1], valid[0][0]], zoom: singleZoom });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const [lat, lon] of valid) bounds.extend([lon, lat]);
  map.fitBounds(bounds, { padding, maxZoom, duration: 600 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Listings — implemented in Task 2
// ─────────────────────────────────────────────────────────────────────────────
export function setListings(_listings) {}
export function addListing(_listing, _opts) {}
export function removeListing(_id) {}
export function focusListing(_id) {}
export function getListing(_id) { return null; }
export function setProfileVisibility(_slug, _visible) {}
export function setSelectedMarker(_id) {}
export function onListingClick(handler) { listingClickHandler = typeof handler === 'function' ? handler : () => {}; }
export function onListingHover(handler) { listingHoverHandler = typeof handler === 'function' ? handler : () => {}; }
export function getPinMode() { return pinMode; }
export function setPinMode(mode) { pinMode = mode === 'detailed' ? 'detailed' : 'compact'; }

// ─────────────────────────────────────────────────────────────────────────────
// Edit mode — implemented in Task 3
// ─────────────────────────────────────────────────────────────────────────────
export async function setEditMode(_state) {}
export async function addEditZone(_zone) {}
export function removeEditZone(_zone) {}
export function setEditColor(_color) {}

// ─────────────────────────────────────────────────────────────────────────────
// Lasso — implemented in Task 4
// ─────────────────────────────────────────────────────────────────────────────
export function setLassoStateChangeHandler(handler) { lassoStateChangeHandler = typeof handler === 'function' ? handler : null; }
export function isLassoActive() { return lassoActive; }
export function startLasso() {}
export function cancelLasso() {}
```

- [ ] **Step 4: Browser verification — base map renders**

```bash
npm start
```

Open `http://localhost:3000/dashboard/` in Chrome with DevTools console open.
Expected:
- Vector basemap renders, centered over Switzerland.
- Custom `#zoom-in` / `#zoom-out` buttons in the floating shell still zoom the map.
- Console: zero red errors. (Yellow warnings about missing sprites/glyphs from the swisstopo style are acceptable on first load — verify they don't repeat indefinitely.)
- Listing pins do not appear (expected — Task 2 implements them).
- Filter / listings / detail panels still mount without throwing (their `app.js` imports resolve because every export is at least a stub).

If the swisstopo style fails to load (CORS, 404), substitute `STYLE_URL` with `'https://tiles.openfreemap.org/styles/liberty'` and rerun. Document the substitution in the commit message.

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html dashboard/map.js
git commit -m "refactor(map): swap Leaflet for MapLibre GL, base 2D scaffold"
```

---

### Task 2: Migrate listing markers (compact + detailed pins)

**Files:**
- Modify: `dashboard/map.js` (replace the Listings stub block)

- [ ] **Step 1: Add safe DOM helpers and marker builders**

Replace the entire `// Listings — implemented in Task 2` block with the following. The marker DOM uses the **same class names and final structure** as the Leaflet `divIcon` produced (so `dashboard/styles.css:1193-1274` keeps applying), built via `createElement` + `textContent` instead of `innerHTML`.

```js
function safeColor(color) {
  const value = String(color || '#56d4b8');
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^hsl\(\s*-?\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%\s*\)$/i.test(value)) return value;
  return '#56d4b8';
}

function dotElement(listing) {
  const root = document.createElement('div');
  root.className = 'map-marker-dot';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const color = safeColor(listing.profileColor);
  dot.style.setProperty('--pin-color', color);
  dot.style.backgroundColor = color;
  root.appendChild(dot);
  return root;
}

function detailedElement(listing) {
  const root = document.createElement('div');
  root.className = 'map-marker-detailed';
  const color = safeColor(listing.profileColor);

  const card = document.createElement('div');
  card.className = 'mp-card';
  card.style.setProperty('--pin-color', color);

  const price = document.createElement('div');
  price.className = 'mp-price';
  price.textContent = Number.isFinite(Number(listing.totalChf))
    ? Number(listing.totalChf).toLocaleString('fr-CH')
    : '—';
  card.appendChild(price);

  const metaParts = [];
  const rooms = Number(listing.rooms);
  if (Number.isFinite(rooms)) metaParts.push((Number.isInteger(rooms) ? rooms.toFixed(0) : rooms.toFixed(1)) + ' p');
  const surface = Number(listing.surfaceM2);
  if (Number.isFinite(surface)) metaParts.push(Math.round(surface) + ' m²');
  if (metaParts.length) {
    const meta = document.createElement('div');
    meta.className = 'mp-meta';
    meta.textContent = metaParts.join(' · ');
    card.appendChild(meta);
  }
  root.appendChild(card);

  const tail = document.createElement('span');
  tail.className = 'mp-tail';
  tail.style.setProperty('--pin-color', color);
  root.appendChild(tail);
  return root;
}

function elementForListing(listing) {
  return pinMode === 'detailed' ? detailedElement(listing) : dotElement(listing);
}

function isProfileVisible(slug) {
  return profileVisibility.get(slug) !== false;
}

function bindMarkerEvents(element, listingId) {
  element.addEventListener('click', (ev) => {
    ev.stopPropagation();
    listingClickHandler(listingId);
  });
  element.addEventListener('mouseenter', () => listingHoverHandler(listingId));
  element.addEventListener('mouseleave', () => listingHoverHandler(null));
}

function attachMarker(listing, opts) {
  if (typeof listing.lat !== 'number' || typeof listing.lon !== 'number') return null;
  if (!isProfileVisible(listing.profileSlug)) return null;

  const element = elementForListing(listing);
  const marker = new maplibregl.Marker({
    element,
    anchor: pinMode === 'detailed' ? 'bottom' : 'center',
    pitchAlignment: 'viewport',
    rotationAlignment: 'viewport'
  }).setLngLat([listing.lon, listing.lat]).addTo(map);

  bindMarkerEvents(element, listing.id);
  if (opts && opts.animate) element.classList.add('marker-drop');

  markersById.set(listing.id, { marker, listing });
  return marker;
}

export function setListings(listings) {
  whenReady(() => {
    for (const [, entry] of markersById) entry.marker.remove();
    markersById.clear();
    for (const listing of listings) attachMarker(listing);
  });
}

export function addListing(listing, opts) {
  whenReady(() => {
    const existing = markersById.get(listing.id);
    if (existing) {
      existing.marker.remove();
      markersById.delete(listing.id);
    }
    attachMarker(listing, opts);
  });
}

export function removeListing(id) {
  const entry = markersById.get(id);
  if (!entry) return;
  entry.marker.remove();
  markersById.delete(id);
}

export function focusListing(id) {
  const entry = markersById.get(id);
  if (!entry) return;
  const lngLat = entry.marker.getLngLat();
  map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 14), duration: 500 });
}

export function getListing(id) {
  const entry = markersById.get(id);
  return entry ? entry.listing : null;
}

export function setProfileVisibility(slug, visible) {
  profileVisibility.set(slug, visible);
  for (const [, entry] of markersById) {
    if (entry.listing.profileSlug !== slug) continue;
    const el = entry.marker.getElement();
    el.style.display = visible ? '' : 'none';
  }
}

export function onListingClick(handler) {
  listingClickHandler = typeof handler === 'function' ? handler : () => {};
}

export function onListingHover(handler) {
  listingHoverHandler = typeof handler === 'function' ? handler : () => {};
}

export function setSelectedMarker(id) {
  for (const [otherId, entry] of markersById) {
    const el = entry.marker.getElement();
    el.classList.toggle('is-selected', otherId === id);
  }
}

export function getPinMode() { return pinMode; }

export function setPinMode(mode) {
  const next = mode === 'detailed' ? 'detailed' : 'compact';
  if (next === pinMode) return;
  pinMode = next;
  try { localStorage.setItem(PIN_MODE_KEY, next); } catch {}
  for (const [id, entry] of markersById) {
    const wasSelected = entry.marker.getElement().classList.contains('is-selected');
    const newEl = elementForListing(entry.listing);
    if (wasSelected) newEl.classList.add('is-selected');
    bindMarkerEvents(newEl, entry.listing.id);
    entry.marker.remove();
    const marker = new maplibregl.Marker({
      element: newEl,
      anchor: next === 'detailed' ? 'bottom' : 'center',
      pitchAlignment: 'viewport',
      rotationAlignment: 'viewport'
    }).setLngLat([entry.listing.lon, entry.listing.lat]).addTo(map);
    markersById.set(id, { marker, listing: entry.listing });
  }
}
```

- [ ] **Step 2: Browser verification — pins render and behave**

Run `npm start`, reload page. Verify against the live data:
- Pins appear at correct positions for every listing with `lat/lon`.
- Hovering a pin highlights the matching row in the listings panel (proves `listingHoverHandler` fires).
- Clicking a pin opens the detail panel (proves `listingClickHandler` fires) **and** does not also trigger the background-click handler (proves `stopPropagation`).
- Toggling the pin mode (compact ↔ detailed) via whatever UI control already exists in `app.js` swaps icons in place.
- Toggling profile visibility hides/shows pins of that profile.
- Console: zero red errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/map.js
git commit -m "refactor(map): port listing markers to maplibregl.Marker"
```

---

### Task 3: Migrate edit-mode commune polygons

**Files:**
- Modify: `dashboard/map.js` (replace the Edit-mode stub block; reuse `polygonCache`, `selectedZones`, `slugToBfs` declared in Task 1)

- [ ] **Step 1: Add the GeoJSON source/layers and edit-mode functions**

The polygon rendering moves to a single source-of-truth GeoJSON FeatureCollection. Each feature's `id` is the BFS commune key (numeric); selection styling is implicit (presence in the source = selected) and hover styling uses `feature-state`.

Replace the `// Edit mode — implemented in Task 3` block with:

```js
const EDIT_SOURCE = 'edit-zones';
const EDIT_FILL_LAYER = 'edit-zones-fill';
const EDIT_OUTLINE_LAYER = 'edit-zones-outline';

function ensureEditLayers() {
  if (map.getSource(EDIT_SOURCE)) return;
  map.addSource(EDIT_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    promoteId: 'bfs'
  });
  map.addLayer({
    id: EDIT_FILL_LAYER,
    type: 'fill',
    source: EDIT_SOURCE,
    paint: {
      'fill-color': ['coalesce', ['feature-state', 'color'], ['get', 'color'], '#16a34a'],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 0.32,
        0.22
      ]
    }
  });
  map.addLayer({
    id: EDIT_OUTLINE_LAYER,
    type: 'line',
    source: EDIT_SOURCE,
    paint: {
      'line-color': ['coalesce', ['feature-state', 'color'], ['get', 'color'], '#16a34a'],
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 1.8,
        1.6
      ],
      'line-opacity': 0.92
    }
  });

  let hoveredBfs = null;

  map.on('mousemove', EDIT_FILL_LAYER, (e) => {
    if (lassoActive || !e.features?.length) return;
    map.getCanvas().style.cursor = 'pointer';
    const id = e.features[0].id;
    if (hoveredBfs !== null && hoveredBfs !== id) {
      map.setFeatureState({ source: EDIT_SOURCE, id: hoveredBfs }, { hover: false });
    }
    hoveredBfs = id;
    map.setFeatureState({ source: EDIT_SOURCE, id }, { hover: true });
  });
  map.on('mouseleave', EDIT_FILL_LAYER, () => {
    if (hoveredBfs !== null) {
      map.setFeatureState({ source: EDIT_SOURCE, id: hoveredBfs }, { hover: false });
      hoveredBfs = null;
    }
    map.getCanvas().style.cursor = '';
  });
  map.on('click', EDIT_FILL_LAYER, (e) => {
    if (lassoActive || !editState || !e.features?.length) return;
    e.originalEvent.stopPropagation();
    const id = e.features[0].id;
    const zone = selectedZones.get(String(id));
    if (zone && editState.onCommuneToggle) editState.onCommuneToggle(zone);
  });
}

function refreshEditSource() {
  const src = map.getSource(EDIT_SOURCE);
  if (!src) return;
  const features = [];
  for (const [bfsKey, zone] of selectedZones) {
    const geom = polygonCache.get(bfsKey);
    if (!geom) continue;
    features.push({
      type: 'Feature',
      id: Number(bfsKey),
      properties: { bfs: Number(bfsKey), color: editState?.color || '#16a34a', slug: zone.slug },
      geometry: geom
    });
  }
  src.setData({ type: 'FeatureCollection', features });
}

function fitToZones(zones) {
  const points = zones.filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lon));
  if (points.length === 0) return;
  if (points.length === 1) {
    map.flyTo({ center: [points[0].lon, points[0].lat], zoom: 12, duration: 500 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const z of points) bounds.extend([z.lon, z.lat]);
  map.fitBounds(bounds, { padding: 80, duration: 500 });
}

export async function setEditMode(state) {
  if (state == null) {
    cancelLasso();
    editState = null;
    selectedZones.clear();
    slugToBfs.clear();
    if (map.getSource(EDIT_SOURCE)) {
      map.getSource(EDIT_SOURCE).setData({ type: 'FeatureCollection', features: [] });
    }
    return;
  }
  editState = state;
  whenReady(async () => {
    ensureEditLayers();
    selectedZones.clear();
    slugToBfs.clear();
    const zones = state.profile.areas || [];
    await Promise.all(zones.map((zone) => ensureSelectedPolygon(zone)));
    refreshEditSource();
    fitToZones(zones);
  });
}

export async function addEditZone(zone) {
  if (!editState) return;
  await ensureSelectedPolygon(zone);
  refreshEditSource();
}

export function removeEditZone(zone) {
  const bfsKey = slugToBfs.get(zone.slug);
  if (!bfsKey) return;
  slugToBfs.delete(zone.slug);
  selectedZones.delete(bfsKey);
  refreshEditSource();
}

export function setEditColor(color) {
  if (!editState) return;
  editState.color = color;
  refreshEditSource();
}

async function ensureSelectedPolygon(zone) {
  let bfsKey = zone.featureId ? String(zone.featureId) : null;
  if (!bfsKey) bfsKey = await resolveBfsKey(zone);
  if (!bfsKey) return;
  if (!polygonCache.has(bfsKey)) {
    const geom = await fetchPolygonByBfs(bfsKey);
    if (!geom) return;
    polygonCache.set(bfsKey, geom);
  }
  selectedZones.set(bfsKey, { ...zone, featureId: bfsKey });
  slugToBfs.set(zone.slug, bfsKey);
}

async function fetchPolygonByBfs(bfsKey) {
  if (polygonCache.has(bfsKey)) return polygonCache.get(bfsKey);
  const url = 'https://api3.geo.admin.ch/rest/services/api/MapServer/'
    + COMMUNE_LAYER + '/' + encodeURIComponent(bfsKey)
    + '?geometryFormat=geojson&sr=4326';
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.feature?.geometry || null;
  } catch { return null; }
}

async function resolveBfsKey(zone) {
  if (!zone || !zone.label) return null;
  const url = 'https://api3.geo.admin.ch/rest/services/api/SearchServer'
    + '?searchText=' + encodeURIComponent(zone.label)
    + '&type=locations&origins=gg25&limit=8';
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const candidates = (data?.results || []).map((r) => r.attrs).filter(Boolean);
    if (!candidates.length) return null;
    if (Number.isFinite(zone.lat) && Number.isFinite(zone.lon)) {
      candidates.sort((a, b) => squaredDistance(a, zone) - squaredDistance(b, zone));
    }
    const id = candidates[0].featureId || candidates[0].id || null;
    return id == null ? null : String(id);
  } catch { return null; }
}

function squaredDistance(a, b) {
  const dx = (Number(a.lon) || 0) - (Number(b.lon) || 0);
  const dy = (Number(a.lat) || 0) - (Number(b.lat) || 0);
  return dx * dx + dy * dy;
}

function featureToZone(feat, bfsKey) {
  const props = feat.properties || feat.attributes || {};
  const label = String(props.gemname || props.label || 'Commune').replace(/\s*\([A-Z]{2}\)\s*$/, '');
  const cantonAbbr = String(props.kanton || '').toLowerCase();
  const center = polygonCenter(feat.geometry);
  return {
    slug: featureToSlug(label),
    label,
    canton: CANTON_MAP[cantonAbbr] || cantonAbbr,
    cantonAbbr: cantonAbbr.toUpperCase(),
    lat: center?.lat,
    lon: center?.lon,
    featureId: bfsKey
  };
}

function featureToSlug(label) {
  return String(label || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function polygonCenter(geom) {
  if (!geom) return null;
  let xs = 0, ys = 0, n = 0;
  const visit = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      xs += coords[0]; ys += coords[1]; n += 1;
      return;
    }
    for (const c of coords) visit(c);
  };
  visit(geom.coordinates);
  return n === 0 ? null : { lon: xs / n, lat: ys / n };
}
```

- [ ] **Step 2: Browser verification — edit polygons render and toggle**

Run `npm start`. Pick any profile, enter "edit areas" mode for a profile with at least 2 saved zones.
- Existing zones render as filled colored polygons sized to the commune.
- Map auto-fits to the zones' bounds.
- Hovering a polygon brightens it (fill-opacity 0.22 → 0.32).
- Clicking a polygon removes it from the profile (round-trips through `editState.onCommuneToggle` defined in `profile-edit.js`).
- Adding a zone via the search/typeahead in `profile-edit.js` calls `addEditZone(zone)` and the new polygon fetches + renders.
- Changing the edit color via the color picker recolors all polygons immediately.
- Exiting edit mode (`setEditMode(null)`) removes all polygon styling from the map.
- Console: zero red errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/map.js
git commit -m "refactor(map): port commune polygon edit mode to maplibre source/layers"
```

---

### Task 4: Migrate lasso draw

**Files:**
- Modify: `dashboard/map.js` (replace the Lasso stub block)

- [ ] **Step 1: Implement lasso with a canvas overlay**

The lasso uses a transparent `<canvas>` absolutely positioned over the map container. The canvas captures pointer events while drawing, lets MapLibre handle everything else.

Replace the `// Lasso — implemented in Task 4` block with:

```js
let lassoCanvas = null;
let lassoCtx = null;
let lassoPoints = null;       // [[lng, lat], ...]
let lassoStartPixel = null;   // {x, y}
let lassoMaxPixelDelta = 0;

function ensureLassoCanvas() {
  if (lassoCanvas) return;
  const container = map.getContainer();
  lassoCanvas = document.createElement('canvas');
  lassoCanvas.className = 'lasso-canvas';
  Object.assign(lassoCanvas.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '5'
  });
  container.appendChild(lassoCanvas);
  lassoCtx = lassoCanvas.getContext('2d');
  resizeLassoCanvas();
  map.on('resize', resizeLassoCanvas);
}

function resizeLassoCanvas() {
  if (!lassoCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = map.getContainer().getBoundingClientRect();
  lassoCanvas.width = rect.width * dpr;
  lassoCanvas.height = rect.height * dpr;
  lassoCanvas.style.width = rect.width + 'px';
  lassoCanvas.style.height = rect.height + 'px';
  lassoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearLassoCanvas() {
  if (!lassoCtx) return;
  const dpr = window.devicePixelRatio || 1;
  lassoCtx.clearRect(0, 0, lassoCanvas.width / dpr, lassoCanvas.height / dpr);
}

function drawLasso() {
  if (!lassoCtx || !lassoPoints || lassoPoints.length < 2) return;
  clearLassoCanvas();
  const color = editState?.color || '#16a34a';
  lassoCtx.strokeStyle = color;
  lassoCtx.fillStyle = color + '22'; // ~13% alpha
  lassoCtx.lineWidth = 2;
  lassoCtx.setLineDash([6, 4]);
  lassoCtx.beginPath();
  for (let i = 0; i < lassoPoints.length; i++) {
    const p = map.project(lassoPoints[i]);
    if (i === 0) lassoCtx.moveTo(p.x, p.y);
    else lassoCtx.lineTo(p.x, p.y);
  }
  lassoCtx.stroke();
}

export function startLasso() {
  if (!map || lassoActive) return;
  whenReady(() => {
    lassoActive = true;
    lassoPoints = null;
    lassoStartPixel = null;
    lassoMaxPixelDelta = 0;

    ensureLassoCanvas();
    const container = map.getContainer();
    container.classList.add('lasso-armed');

    map.dragPan.disable();
    map.boxZoom.disable();
    map.doubleClickZoom.disable();
    map.scrollZoom.disable();
    map.dragRotate.disable();

    container.addEventListener('mousedown', onLassoMouseDown);
    document.addEventListener('keydown', onLassoKeyDown);
    if (lassoStateChangeHandler) lassoStateChangeHandler(true);
  });
}

export function cancelLasso() {
  if (!lassoActive) return;
  finishLasso({ submit: false });
}

function exitLassoMode() {
  if (!map) return;
  const container = map.getContainer();
  container.classList.remove('lasso-armed', 'lasso-drawing');
  map.dragPan.enable();
  map.boxZoom.enable();
  map.doubleClickZoom.enable();
  map.scrollZoom.enable();
  map.dragRotate.enable();
  container.removeEventListener('mousedown', onLassoMouseDown);
  container.removeEventListener('mousemove', onLassoMouseMove);
  document.removeEventListener('mouseup', onLassoMouseUp);
  document.removeEventListener('keydown', onLassoKeyDown);
  clearLassoCanvas();
  lassoActive = false;
  lassoPoints = null;
  lassoStartPixel = null;
  lassoMaxPixelDelta = 0;
  if (lassoStateChangeHandler) lassoStateChangeHandler(false);
}

function onLassoKeyDown(e) {
  if (e.key === 'Escape') cancelLasso();
}

function onLassoMouseDown(e) {
  if (!lassoActive) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = map.getContainer().getBoundingClientRect();
  const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  lassoStartPixel = px;
  lassoMaxPixelDelta = 0;
  const lngLat = map.unproject([px.x, px.y]);
  lassoPoints = [[lngLat.lng, lngLat.lat]];
  map.getContainer().classList.add('lasso-drawing');
  map.getContainer().addEventListener('mousemove', onLassoMouseMove);
  document.addEventListener('mouseup', onLassoMouseUp);
}

function onLassoMouseMove(e) {
  if (!lassoActive || !lassoPoints) return;
  const rect = map.getContainer().getBoundingClientRect();
  const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const lngLat = map.unproject([px.x, px.y]);
  lassoPoints.push([lngLat.lng, lngLat.lat]);
  if (lassoStartPixel) {
    const dx = px.x - lassoStartPixel.x;
    const dy = px.y - lassoStartPixel.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > lassoMaxPixelDelta) lassoMaxPixelDelta = dist;
  }
  drawLasso();
}

async function onLassoMouseUp() {
  if (!lassoActive) return;
  await finishLasso({ submit: true });
}

async function finishLasso({ submit }) {
  const points = lassoPoints || [];
  const enoughPoints = points.length >= LASSO_MIN_POINTS && lassoMaxPixelDelta >= LASSO_MIN_PIXELS;
  if (submit && enoughPoints) {
    try { await selectByPolygon(points); } finally { /* fall through */ }
  }
  exitLassoMode();
}

function simplifyRing(points, minDelta = 5e-4) {
  if (points.length <= 2) return points.map(roundPoint);
  const out = [roundPoint(points[0])];
  for (let i = 1; i < points.length; i++) {
    const [px, py] = out[out.length - 1];
    const [x, y] = points[i];
    if (Math.abs(x - px) >= minDelta || Math.abs(y - py) >= minDelta) out.push(roundPoint(points[i]));
  }
  return out;
}

function roundPoint([x, y]) {
  return [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];
}

async function selectByPolygon(lngLatPairs) {
  if (!editState) return;
  const ring = simplifyRing(lngLatPairs);
  if (ring.length < 3) return;
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push(ring[0]);
  }
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  const extent = `${minLon},${minLat},${maxLon},${maxLat}`;
  const geometry = JSON.stringify({ rings: [ring] });
  const url = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify'
    + '?geometryType=esriGeometryPolygon'
    + '&geometry=' + encodeURIComponent(geometry)
    + '&mapExtent=' + encodeURIComponent(extent)
    + '&imageDisplay=1000,800,96&tolerance=0'
    + '&layers=all:' + COMMUNE_LAYER
    + '&sr=4326&geometryFormat=geojson&returnGeometry=true'
    + '&timeInstant=' + COMMUNE_TIME_INSTANT
    + '&limit=200';
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.error('lasso identify failed', res.status); return; }
    data = await res.json();
  } catch (err) { console.error('lasso identify failed', err); return; }
  const features = (data?.results || []).filter((f) => {
    const props = f.properties || f.attributes || {};
    return props.gde_nr;
  });
  if (features.length === 0) return;
  const callback = editState.onCommuneSelectMany;
  if (callback) {
    const zones = features.map((feat) => {
      const props = feat.properties || feat.attributes || {};
      const bfsKey = String(props.gde_nr);
      const zone = featureToZone(feat, bfsKey);
      if (feat.geometry) polygonCache.set(bfsKey, feat.geometry);
      return zone;
    });
    callback(zones);
  }
}
```

- [ ] **Step 2: Browser verification — lasso draws and selects communes**

Run `npm start`. In edit mode, activate lasso (whatever button `profile-edit.js` exposes) and drag a freeform shape around several communes.
- While dragging, dashed line follows the cursor.
- On mouseup, identify call fires; intersected communes appear as filled polygons.
- Pressing Esc mid-drag cancels cleanly (canvas clears, map drag re-enables).
- Tiny accidental drags (`< LASSO_MIN_POINTS` or `< LASSO_MIN_PIXELS`) are discarded silently.
- After lasso, normal map drag/zoom/scroll-zoom all work again.
- Console: zero red errors. The identify call URL must be unchanged from the Leaflet build (verify in Network tab).

- [ ] **Step 3: Commit**

```bash
git add dashboard/map.js
git commit -m "refactor(map): port lasso draw to canvas overlay over maplibre"
```

---

### Task 5: CSS cleanup — drop Leaflet selectors, add MapLibre equivalents

**Files:**
- Modify: `dashboard/styles.css` (lines ~941–946, ~1183–1190, ~1276–1277)
- Delete: `dashboard/map.leaflet.bak.js` (created in Task 1)

- [ ] **Step 1: Replace cursor selectors for lasso mode**

Find `dashboard/styles.css:941-946` and replace the whole Leaflet cursor block:

```css
.maplibregl-canvas-container.lasso-armed,
.maplibregl-canvas-container.lasso-armed canvas,
.lasso-armed .lasso-canvas { cursor: crosshair !important; }
.maplibregl-canvas-container.lasso-drawing,
.maplibregl-canvas-container.lasso-drawing canvas,
.lasso-drawing .lasso-canvas { cursor: crosshair !important; }
```

Note: the `.lasso-armed` and `.lasso-drawing` classes are added on the **map container**, so the rules above also descend through it. Keep both for robustness.

- [ ] **Step 2: Replace attribution control selector**

Find `dashboard/styles.css:1183` (`.leaflet-control-attribution { ... }`) and rename the selector to `.maplibregl-ctrl-attrib`. Keep all property declarations identical.

- [ ] **Step 3: Drop the now-dead Leaflet rules**

Delete these lines from `dashboard/styles.css`:
- `.leaflet-control-zoom { display: none; }` (line ~1190) — no MapLibre equivalent needed since we never add `NavigationControl`.
- `.leaflet-popup-content-wrapper { ... }` and `.leaflet-popup-content { ... }` (lines ~1276–1277) — popups were never bound; the rules were dead in Leaflet too.

- [ ] **Step 4: Remove the Leaflet backup file**

```bash
rm dashboard/map.leaflet.bak.js
```

- [ ] **Step 5: Browser verification — UI chrome looks identical**

Run `npm start`. Verify:
- Attribution badge in the corner is styled the same (compare against pre-migration screenshot if available).
- No stray default MapLibre zoom buttons are visible (the floating shell's `#zoom-in`/`#zoom-out` are the only zoom controls).
- Lasso cursor still turns to crosshair when armed.

- [ ] **Step 6: Commit**

```bash
git add dashboard/styles.css
git rm dashboard/map.leaflet.bak.js 2>/dev/null || true
git commit -m "refactor(map): drop leaflet css selectors, port to maplibregl equivalents"
```

**🛑 PHASE 1 GATE 🛑**

Before starting Phase 2, run a full smoke pass: load the app, run a scan, open a listing's detail panel from a pin, edit a profile's areas (add via search, add via lasso, remove via click, change color), close edit mode. Every flow must work as before. If anything is off, fix it in Phase 1 — do not paper over it with 3D.

---

## Phase 2 — Activate 3D

Phase 2 turns on the visual capabilities that motivated the migration: terrain, sky, building extrusions, and pitch UX. Each task is independent — they can be merged separately.

### Task 6: Add terrain DEM source and sky layer

**Files:**
- Modify: `dashboard/map.js` (`initMap` and add a new helper)

- [ ] **Step 1: Add terrain + sky after style load**

Inside the existing `map.on('load', () => { … })` callback, **before** flushing `readyQueue`, insert:

```js
map.addSource('terrain-dem', {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
  attribution: '© <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen / Tilezen</a>'
});
map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 });
if (!map.getLayer('sky')) {
  map.addLayer({
    id: 'sky',
    type: 'sky',
    paint: {
      'sky-type': 'atmosphere',
      'sky-atmosphere-sun': [0, 0],
      'sky-atmosphere-sun-intensity': 8
    }
  });
}
```

- [ ] **Step 2: Browser verification — terrain visible at pitch**

Run `npm start`. Pan to the Alps (Valais / Grisons). Hold right-click + drag (MapLibre default rotate gesture) to pitch the view to ~60°. Mountains should rise visibly above the basemap. The sky layer should fade to atmosphere blue at the horizon.
- Confirm 2D views (pitch 0) render exactly as before — terrain should not affect flat presentation.
- Confirm pin positions remain anchored to ground coordinates (they should appear "stuck" to the terrain, which is desired).
- Confirm zoom-in performance stays smooth on Zurich/Geneva (rendering both vector tiles and terrain).
- Console: tile 404s for terrarium tiles outside the basemap zoom (e.g., over open ocean) are acceptable; terrain inside CH must load cleanly.

- [ ] **Step 3: Commit**

```bash
git add dashboard/map.js
git commit -m "feat(map): enable 3d terrain (terrarium DEM) and atmosphere sky"
```

---

### Task 7: Add building extrusions where the style provides them

**Files:**
- Modify: `dashboard/map.js` (extend the `map.on('load', …)` callback)

The swisstopo `leichte-basiskarte.vt` style ships with a `buildings` source layer carrying `height` properties. Add a `fill-extrusion` layer that activates only at high zoom.

- [ ] **Step 1: Add the extrusion layer (fail-soft)**

In the `map.on('load', …)` block, **after** the terrain/sky setup, add:

```js
try {
  // Insert below symbol layers so labels still draw on top.
  const layers = map.getStyle().layers || [];
  const firstSymbolId = layers.find((l) => l.type === 'symbol')?.id;
  // The source layer name in swisstopo's vt is 'building'; abort gracefully if absent.
  const buildingSource = layers.find((l) => l['source-layer'] === 'building' || l['source-layer'] === 'buildings');
  if (buildingSource) {
    map.addLayer({
      id: 'buildings-3d',
      source: buildingSource.source,
      'source-layer': buildingSource['source-layer'],
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#cdd2d8',
        'fill-extrusion-height': ['coalesce', ['get', 'height'], ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'min_height'], ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.85
      }
    }, firstSymbolId);
  }
} catch (err) {
  console.warn('skipping 3D buildings:', err);
}
```

- [ ] **Step 2: Browser verification — buildings extrude in cities**

Zoom into central Zurich (Bahnhofstrasse area) at zoom ≥ 14, pitch ~50°. Buildings should extrude. At zoom < 14 they should disappear cleanly. If the style has no `building` source-layer, the warning fires and Task 7 contributes nothing (acceptable; do not block).

- [ ] **Step 3: Commit**

```bash
git add dashboard/map.js
git commit -m "feat(map): add 3d building extrusions at z>=14"
```

---

### Task 8: Hide detailed pins at extreme pitch

**Files:**
- Modify: `dashboard/map.js` (extend `initMap`)
- Modify: `dashboard/styles.css` (append rule)

At pitch > 55°, detailed pin cards visually overlap and clutter. Compact dots remain readable.

- [ ] **Step 1: Wire a pitch listener to toggle a body class**

Inside `initMap`, after the `map.on('load', …)` block, add:

```js
const PITCH_HIDE_THRESHOLD = 55;
function syncPitchClass() {
  const high = map.getPitch() >= PITCH_HIDE_THRESHOLD;
  document.body.classList.toggle('map-high-pitch', high);
}
map.on('pitch', syncPitchClass);
map.on('pitchend', syncPitchClass);
```

- [ ] **Step 2: Add CSS rule**

Append to `dashboard/styles.css` (after the `.map-marker-detailed` block at line ~1274):

```css
body.map-high-pitch .map-marker-detailed { display: none; }
```

- [ ] **Step 3: Browser verification**

Pitch the map past 55°. Detailed cards (when in detailed pin mode) hide; tilting back below threshold restores them. Compact dot mode is unaffected.

- [ ] **Step 4: Commit**

```bash
git add dashboard/map.js dashboard/styles.css
git commit -m "feat(map): hide detailed pin cards above 55deg pitch"
```

---

### Task 9: Final cross-feature verification & docs touch

**Files:**
- Modify: any docs that explicitly mention Leaflet (search first)

- [ ] **Step 1: Sweep for leftover Leaflet references**

```bash
grep -rn -i "leaflet" dashboard/ docs/ scripts/ README.md 2>/dev/null
```

Expected: zero hits in `dashboard/` and `scripts/`. In `docs/`, prose references to Leaflet in older planning documents are fine (history); update only docs that describe the **current** architecture (e.g., a top-level `README.md` or `docs/superpowers/plans/2026-04-30-map-centric-redesign.md` if it has a "tech stack" line that says Leaflet).

- [ ] **Step 2: Full smoke pass**

Run `npm start` and exercise every map-touching flow:
1. App loads, vector basemap renders, listings appear as pins.
2. Hover and click pins — listings panel highlight + detail panel open.
3. Toggle pin mode — both modes render.
4. Toggle profile visibility — pins hide/show.
5. Open profile edit on a profile with saved zones — polygons render, fit bounds.
6. Add zone via search — polygon appears.
7. Lasso-add zones — multiple polygons appear at once.
8. Click a polygon — it removes from the profile.
9. Change profile color — recolors immediately.
10. Exit edit mode — polygons clear.
11. Right-click + drag to pitch — terrain rises; sky atmosphere shows.
12. Zoom into Zurich at z14, pitch 50° — buildings extrude.
13. Pitch ≥ 55° in detailed pin mode — cards hide; pitch back — return.
14. Browser back/forward — no broken state.
15. DevTools Console: zero red errors across the entire session.

- [ ] **Step 3: Commit any docs touched**

```bash
git add -p docs/ README.md 2>/dev/null
git commit -m "docs: reflect maplibre 3d map in current-architecture references" || true
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "Migrate dashboard map from Leaflet to MapLibre GL with 3D terrain" --body "$(cat <<'EOF'
## Summary
- Replaces Leaflet 1.9.4 with MapLibre GL JS 4.7 in `dashboard/map.js`; public API unchanged so `app.js` and downstream consumers are untouched.
- Base map uses swisstopo's free `leichte-basiskarte.vt` vector style; terrain uses AWS Open Terrain Tiles (terrarium); buildings extrude at z≥14.
- Listing markers stay as DOM elements via `maplibregl.Marker(htmlElement)`, preserving the existing `.map-marker-dot` / `.map-marker-detailed` CSS. Marker DOM is constructed via `createElement` + `textContent` (no `innerHTML`).
- Commune polygons move to a single GeoJSON source + fill/line layers with `feature-state` for hover.
- Lasso reimplemented as a small canvas overlay (no `maplibre-gl-draw` dependency).

## Test plan
- [ ] Base map renders centered on CH; zoom buttons work
- [ ] Listing pins render, hover/click round-trip to listings + detail panels
- [ ] Pin mode toggle (compact ↔ detailed) works
- [ ] Profile visibility toggle hides/shows pins per profile
- [ ] Edit mode: existing zones render, fit bounds, hover brightens, click toggles
- [ ] Edit mode: search-add and lasso-add both work; color change recolors
- [ ] Lasso: Esc cancels, tiny drags discarded, identify URL unchanged in Network tab
- [ ] 3D: pitch reveals terrain; sky atmosphere visible; buildings extrude at z≥14
- [ ] Detailed pins hide above 55° pitch
- [ ] DevTools Console clean across full session
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** every export `app.js` imports (line 1–7) has an implementation in Tasks 1–4. CSS surfaces touched by the migration are addressed in Task 5. The two motivating 3D capabilities (terrain, extrusions) are Tasks 6–7. Pitch UX edge case is Task 8. Docs/sweep is Task 9.
- **Type/name consistency:** `polygonCache`, `selectedZones`, `slugToBfs`, `editState`, `lassoActive`, `lassoStateChangeHandler`, `mapClickHandler`, `pinMode`, `profileVisibility`, `markersById`, `mapReady`, `readyQueue` — all declared in Task 1, used by Tasks 2–4, 6, 8 with the same shapes throughout.
- **No placeholders:** every step has either runnable code, a runnable command, or an explicit browser checklist with measurable conditions.
- **Risk callouts honored in-plan:** swisstopo style fallback (Task 1 Step 4), building-source-layer absence (Task 7 Step 1 try/catch), DEM tile 404s outside CH (Task 6 Step 2 acceptable).
- **XSS hygiene:** marker DOM is built via `createElement` + `textContent`, not `innerHTML`. The migration improves on the prior Leaflet code which used `divIcon({ html: ... })` strings.
