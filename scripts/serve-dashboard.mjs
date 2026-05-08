#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMapListingsPayload } from './map-listings.mjs';
import { migrateTracker, TRACKER_SCHEMA_VERSION } from './tracker-migration.mjs';
import { isValidStatus } from './status.mjs';
import { applyViewedAt } from './mark-viewed.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_DIR = path.join(ROOT, 'dashboard');
const LEGACY_DATA_DIR = path.join(ROOT, 'data');
const PROFILES_DATA_DIR = path.join(LEGACY_DATA_DIR, 'profiles');
const SCRAPE_SCRIPT = path.join(ROOT, 'scripts', 'scrape-immobilier.mjs');

const PORT = Number(process.env.PORT || 8787);
const scanAllJobs = new Map();
const activeScans = new Map(); // slug -> ChildProcess

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
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

async function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2));
  await fs.rename(tmpPath, filePath);
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
    sources: {
      immobilier: true,
      flatfox: true,
      naef: true,
      bernardNicod: true,
      retraitesListings: true,
      retraitesProjets: true,
      anibis: false
    },
    flatfox: { maxPagesPerArea: 3, recheckKnownIdsLimit: 20 },
    filters: {
      maxTotalChf: 1400,
      minRoomsPreferred: 2,
      minSurfaceM2Preferred: 0,
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

  const existingTracker = await readJsonSafe(paths.trackerPath, null);
  if (existingTracker) {
    const { tracker, changed } = migrateTracker(existingTracker);
    if (changed) {
      await writeJsonAtomic(paths.trackerPath, tracker);
    }
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

async function updateStatus(profile, { ids, status, notes }) {
  const paths = await ensureProfileStorage(profile);
  const tracker = await readJsonSafe(paths.trackerPath, null);
  if (!tracker || !Array.isArray(tracker.listings)) return 0;

  const idSet = new Set(ids.map((id) => String(id)));
  const now = new Date().toISOString();
  let updated = 0;

  for (const item of tracker.listings) {
    if (!idSet.has(String(item.id))) continue;
    if (status) item.status = status;
    if (typeof notes === 'string' && idSet.size === 1) item.notes = notes;
    item.updatedAt = now;
    updated += 1;
  }

  if (updated > 0) {
    tracker.updatedAt = now;
    await writeJsonAtomic(paths.trackerPath, tracker);
  }
  return updated;
}

async function togglePin(profile, id) {
  const paths = await ensureProfileStorage(profile);
  const tracker = await readJsonSafe(paths.trackerPath, null);
  if (!tracker || !Array.isArray(tracker.listings)) return null;

  const item = tracker.listings.find((x) => String(x.id) === String(id));
  if (!item) return null;

  item.pinned = !item.pinned;
  item.updatedAt = new Date().toISOString();
  tracker.updatedAt = new Date().toISOString();
  await fs.writeFile(paths.trackerPath, JSON.stringify(tracker, null, 2));

  // Also update latest-listings.json so the dashboard reflects the change immediately
  const latest = await readJsonSafe(paths.latestPath, null);
  if (latest) {
    for (const arr of [latest.all, latest.matching, latest.newListings]) {
      if (!Array.isArray(arr)) continue;
      const found = arr.find((x) => String(x.id) === String(id));
      if (found) found.pinned = item.pinned;
    }
    await fs.writeFile(paths.latestPath, JSON.stringify(latest, null, 2));
  }

  return item.pinned;
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
    latest.totalCount = (latest.all || []).filter((x) => x.status !== 'archived').length;
    latest.removedCount = (latest.all || []).filter((x) => x.status === 'archived').length;
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
      const latestPath = path.join(PROFILES_DATA_DIR, entry.name, 'latest-listings.json');
      const tracker = await readJsonSafe(trackerPath, { listings: [] });
      const latest = await readJsonSafe(latestPath, {});
      const listingsCount = (tracker.listings || []).filter((x) => x.status !== 'archived').length;
      profiles.push({
        slug: entry.name,
        name: cfg.name || entry.name,
        shortTitle,
        label: `Profil – ${shortTitle}`,
        areas,
        listingsCount,
        maxRent: cfg.filters?.maxTotalChf ?? null,
        lastScanAt: latest.generatedAt || null
      });
    }
    profiles.sort((a, b) => a.slug.localeCompare(b.slug));
    return profiles;
  } catch {
    return [];
  }
}

function sanitizeProfileColor(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (/^#[0-9a-f]{3}$/i.test(v) || /^#[0-9a-f]{6}$/i.test(v) || /^#[0-9a-f]{8}$/i.test(v)) return v;
  if (/^hsl\(\s*-?\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%\s*\)$/i.test(v)) return v;
  return null;
}

function buildConfigFromPayload(payload) {
  const shortTitle = String(payload.shortTitle || '').trim();
  const areas = Array.isArray(payload.areas) ? payload.areas.map((a) => {
    const entry = {
      slug: String(a.slug || '').trim(),
      label: String(a.label || '').trim()
    };
    if (a.canton) entry.canton = String(a.canton).trim().toLowerCase();
    if (a.lat != null) entry.lat = Number(a.lat);
    if (a.lon != null) entry.lon = Number(a.lon);
    return entry;
  }).filter((a) => a.slug && a.label) : [];

  const filters = payload.filters || {};
  const sources = payload.sources || {};
  const preferences = payload.preferences || {};
  const color = sanitizeProfileColor(payload.color);

  const maxPublishedAgeRaw = filters.maxPublishedAgeDays;
  const maxPublishedAgeDays =
    maxPublishedAgeRaw === null || maxPublishedAgeRaw === undefined || maxPublishedAgeRaw === ''
      ? null
      : Number(maxPublishedAgeRaw);

  const cfg = {
    name: shortTitle,
    shortTitle,
    areas,
    pagesPerArea: 2,
    sources: {
      immobilier: sources.immobilier !== false,
      flatfox: sources.flatfox !== false,
      naef: sources.naef !== false,
      bernardNicod: sources.bernardNicod !== false,
      retraitesListings: sources.retraitesListings !== false,
      retraitesProjets: sources.retraitesProjets !== false,
      anibis: !!sources.anibis
    },
    flatfox: { maxPagesPerArea: 3, recheckKnownIdsLimit: 20 },
    filters: {
      minTotalChf: Number(filters.minTotalChf) || 0,
      maxTotalChf: Number(filters.maxTotalChf) || 1400,
      minRoomsPreferred: Number(filters.minRoomsPreferred) || 2,
      minSurfaceM2Preferred: Number(filters.minSurfaceM2Preferred) || 0,
      allowMissingSurface: filters.allowMissingSurface !== false,
      excludedObjectTypeKeywords: Array.isArray(filters.excludedObjectTypeKeywords) && filters.excludedObjectTypeKeywords.length
        ? filters.excludedObjectTypeKeywords.map((x) => String(x).trim()).filter(Boolean)
        : ['chambre', 'colocation', 'wg'],
      missingScansBeforeRemoved: Math.max(1, Number(filters.missingScansBeforeRemoved) || 2),
      maxPublishedAgeDays: Number.isFinite(maxPublishedAgeDays) && maxPublishedAgeDays > 0
        ? maxPublishedAgeDays
        : null
    },
    preferences: {
      workplaceAddress: preferences.workplaceAddress || null
    }
  };

  if (color) cfg.color = color;
  return cfg;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === 'GET' && u.pathname === '/api/profiles') {
    const profiles = await listProfiles();
    return sendJson(res, 200, { profiles });
  }

  if (req.method === 'GET' && u.pathname === '/api/map-listings') {
    const payload = await buildMapListingsPayload(PROFILES_DATA_DIR);
    return sendJson(res, 200, payload);
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
        color: cfg.color || null,
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
      await writeJsonAtomic(
        path.join(profileDir, 'tracker.json'),
        { schemaVersion: TRACKER_SCHEMA_VERSION, listings: [], updatedAt: new Date().toISOString() }
      );
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

    const [tracker, latest, config] = await Promise.all([
      readJsonSafe(paths.trackerPath, { schemaVersion: TRACKER_SCHEMA_VERSION, listings: [] }),
      readJsonSafe(paths.latestPath, { all: [], matching: [], generatedAt: null, newCount: 0 }),
      readJsonSafe(paths.configPath, { areas: [] })
    ]);

    // Filter newListings to only today's entries to avoid stale counts
    const today = new Date();
    latest.newListings = (latest.newListings || []).filter((x) => {
      if (!x.firstSeenAt) return false;
      const d = new Date(x.firstSeenAt);
      return d.getFullYear() === today.getFullYear()
        && d.getMonth() === today.getMonth()
        && d.getDate() === today.getDate();
    });
    latest.newCount = latest.newListings.length;

    const areas = (config?.areas || []).map((a) => a?.label).filter(Boolean).join(' · ');

    return sendJson(res, 200, { profile, tracker, latest, areas });
  }

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

  if (req.method === 'POST' && u.pathname === '/api/update-status') {
    const profile = getProfileFromRequest(u);

    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!isValidStatus(body.status)) {
        return sendJson(res, 400, { ok: false, error: 'Statut invalide' });
      }
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id) => typeof id === 'string' || typeof id === 'number')
        : (body.id != null ? [body.id] : []);
      if (!ids.length) {
        return sendJson(res, 400, { ok: false, error: 'id ou ids manquant' });
      }
      const updated = await updateStatus(profile, { ids, status: body.status, notes: body.notes });
      return sendJson(res, updated > 0 ? 200 : 404, { ok: updated > 0, updated });
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

    // Drain stdout/stderr so the child doesn't block, but ignore the human-readable
    // logs (they go to the cron path; here we only care about NDJSON on fd 3).
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});

    let buffer = '';
    let scanDoneSent = false;

    const sendFrame = (payload) => {
      try {
        res.write('data: ' + JSON.stringify(payload) + '\n\n');
      } catch {
        // client may have disconnected; the close handler will clean up
      }
    };

    child.stdio[3].on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue; // skip malformed lines
        }
        sendFrame(event);
        if (event.type === 'scan-done' || event.type === 'scan-error') scanDoneSent = true;
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

  if (req.method === 'POST' && u.pathname === '/api/run-scan-all') {
    // Return immediately, run scans in background
    const profiles = await listProfiles();
    const slugs = profiles.map((p) => p.slug);
    const jobId = Date.now().toString(36);

    scanAllJobs.set(jobId, { status: 'running', total: slugs.length, done: 0, results: [], startedAt: new Date().toISOString() });

    (async () => {
      const job = scanAllJobs.get(jobId);
      for (const slug of slugs) {
        try {
          await ensureProfileStorage(slug);
          const summary = await runScan(slug);
          job.results.push({ slug, ok: true, summary });
        } catch (err) {
          job.results.push({ slug, ok: false, error: err.message });
        }
        job.done += 1;
      }
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      // Clean up old jobs after 10 minutes
      setTimeout(() => scanAllJobs.delete(jobId), 10 * 60 * 1000);
    })();

    return sendJson(res, 202, { ok: true, jobId, total: slugs.length });
  }

  if (req.method === 'GET' && u.pathname === '/api/scan-all-status') {
    const jobId = u.searchParams.get('jobId') || '';
    const job = scanAllJobs.get(jobId);
    if (!job) return sendJson(res, 404, { ok: false, error: 'Job not found' });
    return sendJson(res, 200, { ok: true, ...job });
  }

  if (req.method === 'POST' && u.pathname === '/api/toggle-pin') {
    const profile = getProfileFromRequest(u);

    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const pinned = await togglePin(profile, body.id);
      if (pinned === null) return sendJson(res, 404, { ok: false });
      return sendJson(res, 200, { ok: true, pinned });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
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

  if (req.method === 'GET' && u.pathname === '/') {
    return serveFile(res, path.join(DASHBOARD_DIR, 'index.html'));
  }

  const rootProfileMatch = u.pathname.match(/^\/([a-z0-9-]+)\/?$/i);
  if (req.method === 'GET' && rootProfileMatch && !['api', 'dashboard', 'data'].includes(rootProfileMatch[1])) {
    const profile = sanitizeProfile(rootProfileMatch[1]);
    res.writeHead(302, { location: `/${profile}/dashboard` });
    return res.end();
  }

  const profileDashboardMatch = u.pathname.match(/^\/([a-z0-9-]+)\/dashboard\/?$/i);
  if (req.method === 'GET' && profileDashboardMatch) {
    const slug = profileDashboardMatch[1];
    res.writeHead(302, { Location: '/?profiles=' + encodeURIComponent(slug) });
    return res.end();
  }

  if (req.method === 'GET' && u.pathname.startsWith('/dashboard/')) {
    const relative = u.pathname.replace('/dashboard/', '') || 'index.html';
    return serveFile(res, path.join(DASHBOARD_DIR, relative));
  }

  const profileAssetMatch = u.pathname.match(/^\/([a-z0-9-]+)\/(app\.js|styles\.css|map-utils\.js)$/i);
  if (req.method === 'GET' && profileAssetMatch) {
    return serveFile(res, path.join(DASHBOARD_DIR, profileAssetMatch[2]));
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
