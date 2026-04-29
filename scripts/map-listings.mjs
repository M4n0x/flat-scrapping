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

function profileHash(slug = '') {
  const text = String(slug || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function profileColor(slug = '') {
  return PROFILE_COLORS[profileHash(slug) % PROFILE_COLORS.length];
}

function fallbackProfileColor(slug, index, usedColors) {
  const hash = profileHash(slug);
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const hue = (hash + index * 29 + attempt * 137) % 360;
    const color = `hsl(${hue} 68% 42%)`;
    if (!usedColors.has(color)) return color;
  }
  return `hsl(${hash % 360} 68% ${35 + (index % 25)}%)`;
}

function assignProfileColors(profiles) {
  const usedColors = new Set();

  profiles.forEach((profile, index) => {
    let color = profileColor(profile.slug);
    if (usedColors.has(color)) {
      const preferredIndex = PROFILE_COLORS.indexOf(color);
      color = PROFILE_COLORS.find((candidate, candidateIndex) => (
        candidateIndex > preferredIndex && !usedColors.has(candidate)
      )) || PROFILE_COLORS.find((candidate) => !usedColors.has(candidate));
    }

    profile.color = color || fallbackProfileColor(profile.slug, index, usedColors);
    usedColors.add(profile.color);
  });
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
  if (value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function safeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/data/profiles/')) return raw;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function listingImageUrls(item = {}) {
  return uniqueStrings([
    ...(Array.isArray(item.imageUrlsLocal) ? item.imageUrlsLocal : []),
    ...(Array.isArray(item.imageUrls) ? item.imageUrls : []),
    ...(Array.isArray(item.imageUrlsRemote) ? item.imageUrlsRemote : []),
    item.imageUrl
  ].map(safeImageUrl)).slice(0, 8);
}

function isValidMapPoint(lat, lon) {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
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
  return lat == null || lon == null || !isValidMapPoint(lat, lon) ? null : { lat, lon };
}

export function resolveListingCoordinates(item = {}, geocodeCache = {}) {
  const mapLat = toNumberOrNull(item.mapLat);
  const mapLon = toNumberOrNull(item.mapLon);
  if (mapLat != null && mapLon != null && isValidMapPoint(mapLat, mapLon)) {
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
  return item.active === true
    && item.display !== false
    && item.isRemoved !== true
    && String(item.status || '').trim() !== 'Refusé';
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
    imageUrls: listingImageUrls(item),
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
  assignProfileColors(profiles);

  const profileColors = new Map(profiles.map((profile) => [profile.slug, profile.color]));
  for (const listing of listings) {
    listing.profileColor = profileColors.get(listing.profileSlug) || listing.profileColor;
  }

  return {
    generatedAt: new Date().toISOString(),
    profiles,
    listings,
    totals
  };
}
