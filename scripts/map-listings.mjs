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
