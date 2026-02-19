#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_DIR = path.join(ROOT, 'dashboard');
const LEGACY_DATA_DIR = path.join(ROOT, 'data');
const PROFILES_DATA_DIR = path.join(LEGACY_DATA_DIR, 'profiles');
const SCRAPE_SCRIPT = path.join(ROOT, 'scripts', 'scrape-immobilier.mjs');

const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function sanitizeProfile(value = 'fribourg') {
  const clean = String(value || 'fribourg').trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(clean) ? clean : 'fribourg';
}

function profilePaths(profile) {
  const dataDir = path.join(PROFILES_DATA_DIR, profile);
  return {
    profile,
    dataDir,
    configPath: path.join(dataDir, 'watch-config.json'),
    trackerPath: path.join(dataDir, 'tracker.json'),
    latestPath: path.join(dataDir, 'latest-listings.json'),
    geocodeCachePath: path.join(dataDir, 'geocode-cache.json'),
    routeCachePath: path.join(dataDir, 'route-cache.json')
  };
}

const LEGACY_FILES = {
  configPath: path.join(LEGACY_DATA_DIR, 'watch-config.json'),
  trackerPath: path.join(LEGACY_DATA_DIR, 'tracker.json'),
  latestPath: path.join(LEGACY_DATA_DIR, 'latest-listings.json'),
  geocodeCachePath: path.join(LEGACY_DATA_DIR, 'geocode-cache.json'),
  routeCachePath: path.join(LEGACY_DATA_DIR, 'route-cache.json')
};

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function makeDefaultConfig(profile, base = null) {
  if (base && typeof base === 'object') {
    // Use existing config as template (backward compat for ensureProfileStorage)
    return JSON.parse(JSON.stringify(base));
  }

  // Generic default config for new profiles
  return {
    name: profile.charAt(0).toUpperCase() + profile.slice(1),
    shortTitle: profile.charAt(0).toUpperCase() + profile.slice(1),
    areas: [{ slug: profile, label: profile.charAt(0).toUpperCase() + profile.slice(1) }],
    pagesPerArea: 2,
    sources: { immobilier: true, flatfox: true, homegate: false, anibis: false },
    flatfox: { maxPagesPerArea: 3, recheckKnownIdsLimit: 20 },
    filters: {
      maxTotalChf: 1400,
      maxTotalHardChf: 1550,
      maxPearlTotalChf: 1650,
      minRoomsPreferred: 2,
      minSurfaceM2Preferred: 0,
      allowStudioTransition: true,
      excludedObjectTypeKeywords: ['chambre', 'colocation', 'wg'],
      missingScansBeforeRemoved: 2,
      maxPublishedAgeDays: null
    },
    preferences: {
      workplaceAddress: null
    }
  };
}

async function ensureProfileStorage(profile) {
  const paths = profilePaths(profile);

  await fs.mkdir(PROFILES_DATA_DIR, { recursive: true });
  await fs.mkdir(paths.dataDir, { recursive: true });

  if (profile === 'vevey') {
    for (const key of Object.keys(LEGACY_FILES)) {
      const target = paths[key];
      const legacy = LEGACY_FILES[key];
      if (!(await fileExists(target)) && (await fileExists(legacy))) {
        await fs.copyFile(legacy, target);
      }
    }
  }

  if (!(await fileExists(paths.configPath))) {
    const veveyConfig = await readJsonSafe(path.join(PROFILES_DATA_DIR, 'vevey', 'watch-config.json'), null);
    const legacyConfig = await readJsonSafe(LEGACY_FILES.configPath, null);
    const baseConfig = veveyConfig || legacyConfig || null;
    const cfg = makeDefaultConfig(profile, baseConfig);
    await fs.writeFile(paths.configPath, JSON.stringify(cfg, null, 2));
  }

  return paths;
}

function getProfileFromRequest(u) {
  return sanitizeProfile(u.searchParams.get('profile') || 'fribourg');
}

async function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': MIME['.json'] });
  res.end(body);
}

async function serveFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function updateStatus(profile, id, status, notes) {
  const paths = await ensureProfileStorage(profile);
  const tracker = await readJsonSafe(paths.trackerPath, null);
  if (!tracker || !Array.isArray(tracker.listings)) return false;

  const item = tracker.listings.find((x) => String(x.id) === String(id));
  if (!item) return false;

  if (status) item.status = status;
  if (typeof notes === 'string') item.notes = notes;
  item.updatedAt = new Date().toISOString();

  tracker.updatedAt = new Date().toISOString();
  await fs.writeFile(paths.trackerPath, JSON.stringify(tracker, null, 2));
  return true;
}

async function deleteListing(profile, id) {
  const paths = await ensureProfileStorage(profile);
  const tracker = await readJsonSafe(paths.trackerPath, null);
  if (!tracker || !Array.isArray(tracker.listings)) return false;

  const before = tracker.listings.length;
  tracker.listings = tracker.listings.filter((x) => String(x.id) !== String(id));
  if (tracker.listings.length === before) return false;

  tracker.updatedAt = new Date().toISOString();
  await fs.writeFile(paths.trackerPath, JSON.stringify(tracker, null, 2));

  const latest = await readJsonSafe(paths.latestPath, null);
  if (latest && Array.isArray(latest.all)) {
    latest.all = latest.all.filter((x) => String(x.id) !== String(id));
    latest.matching = (latest.matching || []).filter((x) => String(x.id) !== String(id));
    latest.newListings = (latest.newListings || []).filter((x) => String(x.id) !== String(id));
    latest.totalCount = (latest.all || []).filter((x) => !x.isRemoved).length;
    latest.removedCount = (latest.all || []).filter((x) => x.isRemoved).length;
    latest.matchingCount = latest.matching.length;
    latest.newCount = latest.newListings.length;
    await fs.writeFile(paths.latestPath, JSON.stringify(latest, null, 2));
  }

  return true;
}

async function runScan(profile) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRAPE_SCRIPT, `--profile=${profile}`], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));

    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || out || `Scan failed (${code})`));
    });
  });
}

async function listProfiles() {
  try {
    const entries = await fs.readdir(PROFILES_DATA_DIR, { withFileTypes: true });
    const profiles = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(PROFILES_DATA_DIR, entry.name, 'watch-config.json');
      const cfg = await readJsonSafe(configPath, null);
      if (!cfg) continue;
      const areas = (cfg.areas || []).map((a) => a.label).join(' · ');
      const shortTitle = cfg.shortTitle || entry.name.charAt(0).toUpperCase() + entry.name.slice(1);
      const trackerPath = path.join(PROFILES_DATA_DIR, entry.name, 'tracker.json');
      const tracker = await readJsonSafe(trackerPath, { listings: [] });
      const listingsCount = (tracker.listings || []).filter((x) => !x.isRemoved).length;
      profiles.push({
        slug: entry.name,
        name: cfg.name || entry.name,
        label: `Profil – ${shortTitle}`,
        areas,
        listingsCount,
        maxRent: cfg.filters?.maxTotalChf ?? null
      });
    }
    profiles.sort((a, b) => a.slug.localeCompare(b.slug));
    return profiles;
  } catch {
    return [];
  }
}

function buildConfigFromPayload(payload) {
  const shortTitle = String(payload.shortTitle || '').trim();
  const areas = Array.isArray(payload.areas) ? payload.areas.map((a) => ({
    slug: String(a.slug || '').trim(),
    label: String(a.label || '').trim()
  })).filter((a) => a.slug && a.label) : [];

  const filters = payload.filters || {};
  const sources = payload.sources || {};
  const preferences = payload.preferences || {};

  return {
    name: shortTitle,
    shortTitle,
    areas,
    pagesPerArea: 2,
    sources: {
      immobilier: sources.immobilier !== false,
      flatfox: sources.flatfox !== false,
      homegate: !!sources.homegate,
      anibis: !!sources.anibis
    },
    flatfox: { maxPagesPerArea: 3, recheckKnownIdsLimit: 20 },
    filters: {
      maxTotalChf: Number(filters.maxTotalChf) || 1400,
      maxTotalHardChf: Number(filters.maxTotalHardChf) || 1550,
      maxPearlTotalChf: Number(filters.maxPearlTotalChf) || 1650,
      minRoomsPreferred: Number(filters.minRoomsPreferred) || 2,
      minSurfaceM2Preferred: Number(filters.minSurfaceM2Preferred) || 0,
      allowStudioTransition: !!filters.allowStudioTransition,
      excludedObjectTypeKeywords: ['chambre', 'colocation', 'wg'],
      missingScansBeforeRemoved: 2,
      maxPublishedAgeDays: null
    },
    preferences: {
      workplaceAddress: preferences.workplaceAddress || null
    }
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === 'GET' && u.pathname === '/api/profiles') {
    const profiles = await listProfiles();
    return sendJson(res, 200, { profiles });
  }

  if (req.method === 'GET' && u.pathname === '/api/profile/detail') {
    const slug = sanitizeProfile(u.searchParams.get('profile') || '');
    const configPath = path.join(PROFILES_DATA_DIR, slug, 'watch-config.json');
    const cfg = await readJsonSafe(configPath, null);
    if (!cfg) return sendJson(res, 404, { ok: false, error: 'Profil introuvable' });
    return sendJson(res, 200, {
      ok: true,
      profile: {
        slug,
        shortTitle: cfg.shortTitle || slug,
        areas: cfg.areas || [],
        sources: cfg.sources || {},
        filters: cfg.filters || {},
        preferences: cfg.preferences || {}
      }
    });
  }

  if (req.method === 'POST' && u.pathname === '/api/profile/create') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const slug = sanitizeProfile(payload.slug || '');
      if (!slug) return sendJson(res, 400, { ok: false, error: 'Slug invalide' });

      const profileDir = path.join(PROFILES_DATA_DIR, slug);
      if (await fileExists(path.join(profileDir, 'watch-config.json'))) {
        return sendJson(res, 409, { ok: false, error: 'Ce profil existe déjà' });
      }

      await fs.mkdir(profileDir, { recursive: true });
      const cfg = buildConfigFromPayload(payload);
      await fs.writeFile(path.join(profileDir, 'watch-config.json'), JSON.stringify(cfg, null, 2));
      await fs.writeFile(path.join(profileDir, 'tracker.json'), JSON.stringify({ listings: [], statuses: ['À contacter', 'Visite', 'Dossier', 'Relance', 'Accepté', 'Refusé', 'Sans réponse'], updatedAt: new Date().toISOString() }, null, 2));
      return sendJson(res, 201, { ok: true, slug });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && u.pathname === '/api/profile/update') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const slug = sanitizeProfile(payload.slug || '');
      if (!slug) return sendJson(res, 400, { ok: false, error: 'Slug invalide' });

      const configPath = path.join(PROFILES_DATA_DIR, slug, 'watch-config.json');
      if (!(await fileExists(configPath))) {
        return sendJson(res, 404, { ok: false, error: 'Profil introuvable' });
      }

      const cfg = buildConfigFromPayload(payload);
      await fs.writeFile(configPath, JSON.stringify(cfg, null, 2));
      return sendJson(res, 200, { ok: true, slug });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && u.pathname === '/api/profile/delete') {
    try {
      const raw = await readBody(req);
      const { slug } = JSON.parse(raw || '{}');
      const clean = sanitizeProfile(slug || '');
      if (!clean) return sendJson(res, 400, { ok: false, error: 'Slug invalide' });

      const profileDir = path.join(PROFILES_DATA_DIR, clean);
      if (!(await fileExists(path.join(profileDir, 'watch-config.json')))) {
        return sendJson(res, 404, { ok: false, error: 'Profil introuvable' });
      }

      await fs.rm(profileDir, { recursive: true, force: true });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'GET' && u.pathname === '/api/state') {
    const profile = getProfileFromRequest(u);
    const paths = await ensureProfileStorage(profile);

    const [tracker, latest] = await Promise.all([
      readJsonSafe(paths.trackerPath, { listings: [], statuses: [] }),
      readJsonSafe(paths.latestPath, { all: [], matching: [], generatedAt: null, newCount: 0 })
    ]);

    return sendJson(res, 200, { profile, tracker, latest });
  }

  if (req.method === 'POST' && u.pathname === '/api/update-status') {
    const profile = getProfileFromRequest(u);

    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const ok = await updateStatus(profile, body.id, body.status, body.notes);
      return sendJson(res, ok ? 200 : 404, { ok });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && u.pathname === '/api/run-scan') {
    const profile = getProfileFromRequest(u);

    try {
      await ensureProfileStorage(profile);
      const summary = await runScan(profile);
      return sendJson(res, 200, { ok: true, summary });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && u.pathname === '/api/delete-listing') {
    const profile = getProfileFromRequest(u);

    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const ok = await deleteListing(profile, body.id);
      return sendJson(res, ok ? 200 : 404, { ok });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/dashboard' || u.pathname === '/dashboard/')) {
    return serveFile(res, path.join(DASHBOARD_DIR, 'home.html'));
  }

  const rootProfileMatch = u.pathname.match(/^\/([a-z0-9-]+)\/?$/i);
  if (req.method === 'GET' && rootProfileMatch && !['api', 'dashboard', 'data'].includes(rootProfileMatch[1])) {
    const profile = sanitizeProfile(rootProfileMatch[1]);
    res.writeHead(302, { location: `/${profile}/dashboard` });
    return res.end();
  }

  const profileTrailingSlashMatch = u.pathname.match(/^\/([a-z0-9-]+)\/dashboard\/$/i);
  if (req.method === 'GET' && profileTrailingSlashMatch) {
    const profile = sanitizeProfile(profileTrailingSlashMatch[1]);
    res.writeHead(302, { location: `/${profile}/dashboard` });
    return res.end();
  }

  if (req.method === 'GET' && u.pathname.startsWith('/dashboard/')) {
    const relative = u.pathname.replace('/dashboard/', '') || 'index.html';
    return serveFile(res, path.join(DASHBOARD_DIR, relative));
  }

  const profileAssetMatch = u.pathname.match(/^\/([a-z0-9-]+)\/(app\.js|styles\.css)$/i);
  if (req.method === 'GET' && profileAssetMatch) {
    return serveFile(res, path.join(DASHBOARD_DIR, profileAssetMatch[2]));
  }

  const dashboardMatch = u.pathname.match(/^\/([a-z0-9-]+)\/dashboard(?:\/(.*))?$/i);
  if (req.method === 'GET' && dashboardMatch) {
    const profile = sanitizeProfile(dashboardMatch[1]);
    const relative = dashboardMatch[2] || 'index.html';

    if (relative === 'index.html') {
      await ensureProfileStorage(profile);
    }

    return serveFile(res, path.join(DASHBOARD_DIR, relative));
  }

  if (req.method === 'GET' && u.pathname.startsWith('/data/')) {
    const relative = u.pathname.replace('/data/', '');
    return serveFile(res, path.join(LEGACY_DATA_DIR, relative));
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Dashboard local prêt: http://localhost:${PORT}/`);
});
