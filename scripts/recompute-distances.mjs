#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function sanitizeProfile(value = 'fribourg') {
  const clean = String(value || 'fribourg').trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(clean) ? clean : 'fribourg';
}

function parseProfileFromArgv(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg.startsWith('--profile=')) return arg.slice('--profile='.length);
    if (arg === '--profile') return argv[i + 1] || 'fribourg';
  }
  return null;
}

const PROFILE = sanitizeProfile(process.env.APART_PROFILE || parseProfileFromArgv() || 'fribourg');
const DATA_DIR = path.join(ROOT, 'data', 'profiles', PROFILE);
const CONFIG_PATH = path.join(DATA_DIR, 'watch-config.json');
const TRACKER_PATH = path.join(DATA_DIR, 'tracker.json');
const GEOCODE_CACHE_PATH = path.join(DATA_DIR, 'geocode-cache.json');
const ROUTE_CACHE_PATH = path.join(DATA_DIR, 'route-cache.json');

async function readJsonSafe(p, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'apartment-search/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

async function geocodeAddress(query, cache) {
  const key = query.toLowerCase().trim();
  if (cache[key]) return cache[key];
  
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const results = await httpsGet(url);
  if (results?.[0]) {
    const point = { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
    cache[key] = point;
    return point;
  }
  cache[key] = null;
  return null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchDrivingMinutes(listingCoords, workCoords, cache) {
  // Route: apartment -> work (commute to office)
  const key = `drive:${listingCoords.lat.toFixed(5)},${listingCoords.lon.toFixed(5)}->${workCoords.lat.toFixed(5)},${workCoords.lon.toFixed(5)}`;
  if (cache[key]?.minutes != null) return cache[key].minutes;
  
  // OSRM: origin;destination (apartment -> work)
  const url = `https://router.project-osrm.org/route/v1/driving/${listingCoords.lon},${listingCoords.lat};${workCoords.lon},${workCoords.lat}?overview=false`;
  const data = await httpsGet(url);
  const seconds = data?.routes?.[0]?.duration;
  const minutes = seconds ? Math.round(seconds / 60) : null;
  cache[key] = { minutes, updatedAt: new Date().toISOString() };
  return minutes;
}

async function fetchTransitMinutes(listingAddress, workAddress, cache) {
  // Transit: apartment -> work (Monday arrival 8:00)
  const key = `transit:monday-arr0800:${listingAddress.toLowerCase()}->${workAddress.toLowerCase()}`;
  if (cache[key]?.minutes != null) return cache[key].minutes;
  // Transit API would go here - for now return null
  // TODO: Could use SBB/transport.opendata.ch API for Swiss transit
  cache[key] = { minutes: null, updatedAt: new Date().toISOString() };
  return null;
}

async function main() {
  console.log(`Recomputing distances for profile: ${PROFILE}`);
  
  const config = await readJsonSafe(CONFIG_PATH, {});
  const tracker = await readJsonSafe(TRACKER_PATH, { listings: [] });
  const geocodeCache = await readJsonSafe(GEOCODE_CACHE_PATH, {});
  const routeCache = await readJsonSafe(ROUTE_CACHE_PATH, {});
  
  const workAddress = config.preferences?.workplaceAddress || 'Rue Etraz 4, 1003 Lausanne, Suisse';
  console.log(`Workplace: ${workAddress}`);
  console.log(`Commute direction: Apartment -> Work (Monday arrival 8h)`);
  
  const workCoords = await geocodeAddress(workAddress, geocodeCache);
  if (!workCoords) {
    console.error('Could not geocode workplace address');
    return;
  }
  console.log(`Work coords: ${workCoords.lat}, ${workCoords.lon}`);
  
  let updated = 0;
  for (const listing of tracker.listings) {
    const addr = listing.address || '';
    if (!addr) continue;
    
    const listingCoords = await geocodeAddress(addr + ', Suisse', geocodeCache);
    if (!listingCoords) {
      console.log(`  Skip ${listing.id}: could not geocode "${addr}"`);
      continue;
    }
    
    const distanceKm = haversineKm(workCoords.lat, workCoords.lon, listingCoords.lat, listingCoords.lon);
    const driveMinutes = await fetchDrivingMinutes(listingCoords, workCoords, routeCache);
    const transitMinutes = await fetchTransitMinutes(addr + ', Suisse', workAddress, routeCache);
    
    listing.distanceKm = Number(distanceKm.toFixed(1));
    listing.distanceText = `${listing.distanceKm} km`;
    listing.distanceComputed = true;
    listing.distanceFromWorkAddress = workAddress;
    listing.driveMinutes = driveMinutes;
    listing.driveText = driveMinutes ? `${driveMinutes} min` : '';
    listing.transitMinutes = transitMinutes;
    listing.transitText = transitMinutes ? `${transitMinutes} min` : '';
    
    console.log(`  ${listing.id}: ${listing.distanceKm} km, ${driveMinutes ?? '?'} min drive`);
    updated++;
    
    // Small delay to be nice to APIs
    await new Promise(r => setTimeout(r, 200));
  }
  
  await writeJson(TRACKER_PATH, tracker);
  await writeJson(GEOCODE_CACHE_PATH, geocodeCache);
  await writeJson(ROUTE_CACHE_PATH, routeCache);
  
  console.log(`\nDone! Updated ${updated}/${tracker.listings.length} listings`);
}

main().catch(console.error);
