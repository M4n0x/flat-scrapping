import { popupHtml } from '/dashboard/map-utils.js';

const SWITZERLAND_VIEW = { center: [46.8182, 8.2275], zoom: 8 };
const DETAIL_ZOOM = 13;

let map = null;
let clusterGroup = null;
let dotsGroup = null;
const markersById = new Map();          // id -> { detail, dot, listing }
const profileVisibility = new Map();    // slug -> boolean
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
  // Allow only hex values or hsl() expressions from our own palette.
  const value = String(color || '#56d4b8');
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (/^hsl\(\s*-?\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%\s*\)$/i.test(value)) return value;
  return '#56d4b8';
}

function detailIcon(listing) {
  const color = safeColor(listing.profileColor);
  const wrapper = document.createElement('span');
  wrapper.className = 'pin';
  wrapper.style.color = color;
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-location-dot';
  wrapper.appendChild(icon);
  return L.divIcon({
    className: 'map-marker-detail',
    html: wrapper.outerHTML,
    iconSize: [32, 32],
    iconAnchor: [16, 30],
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
    iconSize: [10, 10],
    iconAnchor: [5, 5]
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
