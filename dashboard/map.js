// Leaflet map: pins, edit-mode commune polygons (selected only) + lasso draw.
// Detail panel handles per-listing UI; this module never binds Leaflet popups.

const SWITZERLAND_VIEW = { center: [46.8182, 8.2275], zoom: 8 };
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

let map = null;
let pinsGroup = null;
let editLayerGroup = null;
const markersById = new Map();          // id -> { marker, listing }
const profileVisibility = new Map();    // slug -> boolean
let listingClickHandler = () => {};
let listingHoverHandler = () => {};

const PIN_MODE_KEY = 'apartment-ops:pin-mode:v1';
let pinMode = readPinMode();

function readPinMode() {
  try { return localStorage.getItem(PIN_MODE_KEY) === 'detailed' ? 'detailed' : 'compact'; }
  catch { return 'compact'; }
}

// Edit mode state
let editState = null;       // { profile, color, onCommuneToggle }
const polygonCache = new Map();         // bfsKey -> GeoJSON geometry
const featureLayers = new Map();        // bfsKey -> { layer, zone }
const slugToBfs = new Map();            // slug -> bfsKey

// Lasso state
let lassoActive = false;
let lassoCurrentPath = null;
let lassoCurrentPoints = null;
let lassoStartPixel = null;
let lassoMaxPixelDelta = 0;
let lassoStateChangeHandler = null;

export function initMap(container) {
  if (map) return { map };
  map = L.map(container, { preferCanvas: false, zoomControl: false })
    .setView(SWITZERLAND_VIEW.center, SWITZERLAND_VIEW.zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  pinsGroup = L.layerGroup().addTo(map);
  editLayerGroup = L.layerGroup();

  bindZoomButtons();

  map.on('click', (e) => {
    if (mapClickHandler) mapClickHandler(e);
  });

  return { map };
}

let mapClickHandler = null;
export function onMapBackgroundClick(handler) {
  mapClickHandler = typeof handler === 'function' ? handler : null;
}

function bindZoomButtons() {
  const inBtn = document.getElementById('zoom-in');
  const outBtn = document.getElementById('zoom-out');
  if (inBtn) inBtn.addEventListener('click', () => map.zoomIn());
  if (outBtn) outBtn.addEventListener('click', () => map.zoomOut());
}

function isProfileVisible(slug) {
  return profileVisibility.get(slug) !== false;
}

function safeColor(color) {
  const value = String(color || '#56d4b8');
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^hsl\(\s*-?\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%\s*\)$/i.test(value)) return value;
  return '#56d4b8';
}

function dotIcon(listing) {
  const color = safeColor(listing.profileColor);
  const html = '<span class="dot" style="--pin-color:' + color + ';background-color:' + color + '"></span>';
  return L.divIcon({
    className: 'map-marker-dot',
    html,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

function detailedIcon(listing) {
  const color = safeColor(listing.profileColor);
  const priceTxt = Number.isFinite(Number(listing.totalChf))
    ? Number(listing.totalChf).toLocaleString('fr-CH')
    : '—';
  const meta = [];
  const rooms = Number(listing.rooms);
  if (Number.isFinite(rooms)) meta.push((Number.isInteger(rooms) ? rooms.toFixed(0) : rooms.toFixed(1)) + ' p');
  const surface = Number(listing.surfaceM2);
  if (Number.isFinite(surface)) meta.push(Math.round(surface) + ' m²');

  const html =
    '<div class="mp-card" style="--pin-color:' + color + '">'
    +   '<div class="mp-price">' + priceTxt + '</div>'
    +   (meta.length ? '<div class="mp-meta">' + meta.join(' · ') + '</div>' : '')
    + '</div>'
    + '<span class="mp-tail" style="--pin-color:' + color + '"></span>';

  return L.divIcon({
    className: 'map-marker-detailed',
    html,
    iconSize: [110, 56],
    iconAnchor: [55, 56]
  });
}

function iconForListing(listing) {
  return pinMode === 'detailed' ? detailedIcon(listing) : dotIcon(listing);
}

export function getPinMode() { return pinMode; }

export function setPinMode(mode) {
  const next = mode === 'detailed' ? 'detailed' : 'compact';
  if (next === pinMode) return;
  pinMode = next;
  try { localStorage.setItem(PIN_MODE_KEY, next); } catch {}
  for (const [, entry] of markersById) {
    const wasSelected = entry.marker.getElement()?.classList.contains('is-selected');
    entry.marker.setIcon(iconForListing(entry.listing));
    if (wasSelected) entry.marker.getElement()?.classList.add('is-selected');
  }
}

function attachMarker(listing, opts) {
  if (typeof listing.lat !== 'number' || typeof listing.lon !== 'number') return null;
  if (!isProfileVisible(listing.profileSlug)) return null;

  const marker = L.marker([listing.lat, listing.lon], { icon: iconForListing(listing) });
  marker.on('click', () => listingClickHandler(listing.id));
  marker.on('mouseover', () => listingHoverHandler(listing.id));
  marker.on('mouseout', () => listingHoverHandler(null));
  pinsGroup.addLayer(marker);

  if (opts && opts.animate) {
    marker.once('add', () => {
      const el = marker.getElement();
      if (el) el.classList.add('marker-drop');
    });
  }

  markersById.set(listing.id, { marker, listing });
  return marker;
}

export function setListings(listings) {
  pinsGroup.clearLayers();
  markersById.clear();
  for (const listing of spreadColocatedListings(listings)) attachMarker(listing);
}

// Listings that share the exact same coordinates would stack and only the top
// pin would be visible. Spread duplicates around the original point on a small
// ring so each one is independently clickable.
function spreadColocatedListings(listings) {
  const RING_RADIUS_DEG = 0.00018; // ~20m at our latitudes
  const groups = new Map();
  for (const listing of listings) {
    if (!Number.isFinite(listing.lat) || !Number.isFinite(listing.lon)) continue;
    const key = listing.lat.toFixed(6) + ',' + listing.lon.toFixed(6);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(listing);
  }

  const offsets = new Map(); // id -> { lat, lon }
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const lonScale = 1 / Math.max(0.1, Math.cos((group[0].lat * Math.PI) / 180));
    for (let i = 0; i < group.length; i += 1) {
      const angle = (2 * Math.PI * i) / group.length;
      offsets.set(group[i].id, {
        lat: group[i].lat + RING_RADIUS_DEG * Math.cos(angle),
        lon: group[i].lon + RING_RADIUS_DEG * Math.sin(angle) * lonScale
      });
    }
  }

  if (offsets.size === 0) return listings;
  return listings.map((listing) => {
    const next = offsets.get(listing.id);
    return next ? { ...listing, lat: next.lat, lon: next.lon } : listing;
  });
}

export function addListing(listing, opts) {
  const existing = markersById.get(listing.id);
  if (existing) {
    pinsGroup.removeLayer(existing.marker);
    markersById.delete(listing.id);
  }
  attachMarker(listing, opts);
}

export function removeListing(id) {
  const entry = markersById.get(id);
  if (!entry) return;
  pinsGroup.removeLayer(entry.marker);
  markersById.delete(id);
}

export function focusListing(id) {
  const entry = markersById.get(id);
  if (!entry) return;
  map.setView(entry.marker.getLatLng(), Math.max(map.getZoom(), 14));
}

export function getListing(id) {
  const entry = markersById.get(id);
  return entry ? entry.listing : null;
}

export function setProfileVisibility(slug, visible) {
  profileVisibility.set(slug, visible);
  for (const [, entry] of markersById) {
    if (entry.listing.profileSlug !== slug) continue;
    if (visible) pinsGroup.addLayer(entry.marker);
    else pinsGroup.removeLayer(entry.marker);
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
    if (el) el.classList.toggle('is-selected', otherId === id);
  }
}

export function getMap() {
  return map;
}

export function fitMapToPoints(points, { padding = 0.18, singleZoom = 12, maxZoom = 14 } = {}) {
  if (!map || !Array.isArray(points) || points.length === 0) return;
  const valid = points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (valid.length === 0) return;
  if (valid.length === 1) {
    map.setView(valid[0], singleZoom);
    return;
  }
  const bounds = L.latLngBounds(valid).pad(padding);
  map.fitBounds(bounds, { maxZoom });
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit mode
//
// Selected zones get a filled colored polygon (clickable to remove).
// To add zones, the user enables Lasso mode and drags a freehand shape; every
// commune intersecting the shape is fetched in one identify call and added to
// the profile.
// ─────────────────────────────────────────────────────────────────────────────

export async function setEditMode(state) {
  if (state == null) {
    cancelLasso();
    editState = null;
    if (editLayerGroup) {
      editLayerGroup.clearLayers();
      if (map.hasLayer(editLayerGroup)) map.removeLayer(editLayerGroup);
    }
    featureLayers.clear();
    slugToBfs.clear();
    return;
  }
  editState = state;
  if (!map.hasLayer(editLayerGroup)) map.addLayer(editLayerGroup);
  editLayerGroup.clearLayers();
  featureLayers.clear();
  slugToBfs.clear();

  const zones = state.profile.areas || [];
  await Promise.all(zones.map((zone) => ensureSelectedPolygon(zone)));
  fitToZones(zones);
}

export async function addEditZone(zone) {
  if (!editState) return;
  await ensureSelectedPolygon(zone);
}

export function removeEditZone(zone) {
  const bfsKey = slugToBfs.get(zone.slug);
  if (!bfsKey) return;
  slugToBfs.delete(zone.slug);
  const entry = featureLayers.get(bfsKey);
  if (!entry) return;
  editLayerGroup.removeLayer(entry.layer);
  featureLayers.delete(bfsKey);
}

export function setEditColor(color) {
  if (!editState) return;
  editState.color = color;
  for (const [, entry] of featureLayers) {
    entry.layer.setStyle(selectedStyle(color));
  }
  if (lassoCurrentPath) lassoCurrentPath.setStyle(lassoStyle(color));
}

function fitToZones(zones) {
  const points = zones.filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lon))
    .map((z) => [z.lat, z.lon]);
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView(points[0], 12);
    return;
  }
  const bounds = L.latLngBounds(points);
  map.fitBounds(bounds.pad(0.2));
}

async function ensureSelectedPolygon(zone) {
  let bfsKey = zone.featureId ? String(zone.featureId) : null;
  if (!bfsKey) bfsKey = await resolveBfsKey(zone);
  if (!bfsKey) return;

  const existing = featureLayers.get(bfsKey);
  if (existing) {
    existing.zone = { ...zone, featureId: bfsKey };
    existing.layer.setStyle(selectedStyle(editState.color));
    slugToBfs.set(zone.slug, bfsKey);
    return;
  }

  const geom = await fetchPolygonByBfs(bfsKey);
  if (!geom || !editState) return;
  attachLayer({ ...zone, featureId: bfsKey }, bfsKey, geom);
  slugToBfs.set(zone.slug, bfsKey);
}

function attachLayer(zone, bfsKey, geom) {
  const color = editState.color || '#16a34a';
  const layer = L.geoJSON(geom, { style: () => selectedStyle(color) });

  layer.on('click', (evt) => {
    if (lassoActive) return;             // clicks belong to the lasso while drawing
    L.DomEvent.stopPropagation(evt);
    const entry = featureLayers.get(bfsKey);
    if (!editState || !entry) return;
    if (editState.onCommuneToggle) editState.onCommuneToggle(entry.zone);
  });
  layer.on('mouseover', () => {
    const entry = featureLayers.get(bfsKey);
    if (entry) entry.layer.setStyle(hoverStyle(editState.color));
  });
  layer.on('mouseout', () => {
    const entry = featureLayers.get(bfsKey);
    if (entry) entry.layer.setStyle(selectedStyle(editState.color));
  });

  editLayerGroup.addLayer(layer);
  featureLayers.set(bfsKey, { layer, zone });
}

function selectedStyle(color) {
  return { color, weight: 1.6, fillColor: color, fillOpacity: 0.22, opacity: 0.9 };
}

function hoverStyle(color) {
  return { color, weight: 1.8, fillColor: color, fillOpacity: 0.32, opacity: 0.95 };
}

function lassoStyle(color) {
  return { color, weight: 2, fillColor: color, fillOpacity: 0.10, opacity: 0.85, dashArray: '6 4' };
}

async function fetchPolygonByBfs(bfsKey) {
  if (polygonCache.has(bfsKey)) return polygonCache.get(bfsKey);
  const url = 'https://api3.geo.admin.ch/rest/services/api/MapServer/'
    + COMMUNE_LAYER
    + '/' + encodeURIComponent(bfsKey)
    + '?geometryFormat=geojson&sr=4326';
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const geom = data?.feature?.geometry || null;
    if (geom) polygonCache.set(bfsKey, geom);
    return geom;
  } catch {
    return null;
  }
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
  } catch {
    return null;
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Lasso draw — drag a freehand shape, then identify the communes it covers.
// ─────────────────────────────────────────────────────────────────────────────

export function setLassoStateChangeHandler(handler) {
  lassoStateChangeHandler = typeof handler === 'function' ? handler : null;
}

export function isLassoActive() {
  return lassoActive;
}

export function startLasso() {
  if (!map || lassoActive) return;
  lassoActive = true;
  lassoCurrentPoints = null;
  lassoCurrentPath = null;
  lassoStartPixel = null;
  lassoMaxPixelDelta = 0;

  const container = map.getContainer();
  container.classList.add('lasso-armed');
  map.dragging.disable();
  map.boxZoom.disable();
  map.doubleClickZoom.disable();
  map.scrollWheelZoom.disable();

  map.on('mousedown', onLassoMouseDown);
  document.addEventListener('keydown', onLassoKeyDown);

  if (lassoStateChangeHandler) lassoStateChangeHandler(true);
}

export function cancelLasso() {
  if (!lassoActive) return;
  finishLasso({ submit: false });
}

function exitLassoMode() {
  if (!map) return;
  const container = map.getContainer();
  container.classList.remove('lasso-armed');
  container.classList.remove('lasso-drawing');
  map.dragging.enable();
  map.boxZoom.enable();
  map.doubleClickZoom.enable();
  map.scrollWheelZoom.enable();

  map.off('mousedown', onLassoMouseDown);
  map.off('mousemove', onLassoMouseMove);
  map.off('mouseup', onLassoMouseUp);
  document.removeEventListener('keydown', onLassoKeyDown);

  lassoActive = false;
  if (lassoCurrentPath) {
    editLayerGroup.removeLayer(lassoCurrentPath);
    lassoCurrentPath = null;
  }
  lassoCurrentPoints = null;
  lassoStartPixel = null;
  lassoMaxPixelDelta = 0;
  if (lassoStateChangeHandler) lassoStateChangeHandler(false);
}

function onLassoKeyDown(e) {
  if (e.key === 'Escape') cancelLasso();
}

function onLassoMouseDown(e) {
  if (!lassoActive) return;
  L.DomEvent.preventDefault(e.originalEvent);
  L.DomEvent.stopPropagation(e.originalEvent);
  lassoCurrentPoints = [e.latlng];
  lassoStartPixel = e.containerPoint;
  lassoMaxPixelDelta = 0;

  if (lassoCurrentPath) editLayerGroup.removeLayer(lassoCurrentPath);
  const color = editState?.color || '#16a34a';
  lassoCurrentPath = L.polyline([e.latlng], lassoStyle(color));
  editLayerGroup.addLayer(lassoCurrentPath);

  map.getContainer().classList.add('lasso-drawing');
  map.on('mousemove', onLassoMouseMove);
  map.on('mouseup', onLassoMouseUp);
}

function onLassoMouseMove(e) {
  if (!lassoActive || !lassoCurrentPoints || !lassoCurrentPath) return;
  lassoCurrentPoints.push(e.latlng);
  lassoCurrentPath.addLatLng(e.latlng);
  if (lassoStartPixel) {
    const dx = e.containerPoint.x - lassoStartPixel.x;
    const dy = e.containerPoint.y - lassoStartPixel.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > lassoMaxPixelDelta) lassoMaxPixelDelta = dist;
  }
}

async function onLassoMouseUp(e) {
  if (!lassoActive) return;
  await finishLasso({ submit: true });
}

async function finishLasso({ submit }) {
  const points = lassoCurrentPoints || [];
  const path = lassoCurrentPath;
  const enoughPoints = points.length >= LASSO_MIN_POINTS && lassoMaxPixelDelta >= LASSO_MIN_PIXELS;

  if (path && submit && enoughPoints) {
    path.setStyle({ ...lassoStyle(editState?.color || '#16a34a'), dashArray: null, fillOpacity: 0.18 });
    path.addLatLng(points[0]);
    try {
      const polygon = L.polygon(path.getLatLngs(), lassoStyle(editState?.color || '#16a34a'));
      editLayerGroup.removeLayer(path);
      lassoCurrentPath = polygon;
      editLayerGroup.addLayer(polygon);
      await selectByPolygon(points);
    } finally {
      if (lassoCurrentPath) {
        editLayerGroup.removeLayer(lassoCurrentPath);
        lassoCurrentPath = null;
      }
    }
  } else if (path) {
    editLayerGroup.removeLayer(path);
    lassoCurrentPath = null;
  }

  exitLassoMode();
}

// The identify endpoint is GET-only and the URL has a hard length cap, so
// shrink the ring before serializing: drop points within ~55 m of the previous
// kept point and round to 5 decimals (≈1 m precision — far finer than commune
// boundaries need). A typical lasso shrinks from 200+ points to <40.
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

async function selectByPolygon(latlngs) {
  if (!editState) return;
  const ring = simplifyRing(latlngs.map((p) => [p.lng, p.lat]));
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
    if (!res.ok) {
      console.error('lasso identify failed', res.status);
      return;
    }
    data = await res.json();
  } catch (err) {
    console.error('lasso identify failed', err);
    return;
  }

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
      // Pre-cache the geometry so addEditZone(zone) doesn't have to refetch.
      if (feat.geometry) polygonCache.set(bfsKey, feat.geometry);
      return zone;
    });
    callback(zones);
  }
}
