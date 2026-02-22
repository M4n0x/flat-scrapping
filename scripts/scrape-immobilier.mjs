#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const LEGACY_DATA_DIR = path.join(ROOT, 'data');
const PROFILES_DATA_DIR = path.join(LEGACY_DATA_DIR, 'profiles');
const DEFAULT_WORK_ADDRESS = 'Gare de Fribourg, 1700 Fribourg, Suisse';
const TRAVEL_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function sanitizeProfile(value = 'fribourg') {
  const clean = String(value || 'fribourg').trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(clean) ? clean : 'fribourg';
}

function parseProfileFromArgv(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg.startsWith('--profile=')) {
      return arg.slice('--profile='.length);
    }
    if (arg === '--profile') {
      return argv[i + 1] || 'fribourg';
    }
  }
  return null;
}

function profilePaths(profile) {
  const dataDir = path.join(PROFILES_DATA_DIR, profile);
  return {
    dataDir,
    configPath: path.join(dataDir, 'watch-config.json'),
    trackerPath: path.join(dataDir, 'tracker.json'),
    latestPath: path.join(dataDir, 'latest-listings.json'),
    geocodeCachePath: path.join(dataDir, 'geocode-cache.json'),
    routeCachePath: path.join(dataDir, 'route-cache.json')
  };
}

const PROFILE = sanitizeProfile(process.env.APART_PROFILE || parseProfileFromArgv() || 'fribourg');
const {
  dataDir: DATA_DIR,
  configPath: CONFIG_PATH,
  trackerPath: TRACKER_PATH,
  latestPath: LATEST_PATH,
  geocodeCachePath: GEOCODE_CACHE_PATH,
  routeCachePath: ROUTE_CACHE_PATH
} = profilePaths(PROFILE);

const STATUSES = ['À contacter', 'Visite', 'Dossier', 'Relance', 'Accepté', 'Refusé', 'Sans réponse'];
const SOURCE_PRIORITY = {
  'immobilier.ch': 30,
  'naef.ch': 27,
  'bernard-nicod.ch': 26,
  'flatfox.ch': 20,
  'retraitespopulaires.ch': 18,
  'anibis.ch': 15
};

const DEFAULT_NON_SPECULATIVE_GROUPS = [];

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
const IMAGE_EXT_BY_CONTENT_TYPE = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif'
};

function decodeHtml(input = '') {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(html = '') {
  return decodeHtml(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function isHttpUrl(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function imageExtFromUrl(value = '') {
  try {
    const pathname = new URL(String(value || '')).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext) ? ext : '';
  } catch {
    return '';
  }
}

function imageExtFromContentType(value = '') {
  const raw = String(value || '').toLowerCase().split(';')[0].trim();
  return IMAGE_EXT_BY_CONTENT_TYPE[raw] || '';
}

async function fetchBinary(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      accept: 'image/*,*/*;q=0.8'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  return { buffer: buf, contentType };
}

async function findExistingImageFile(baseNoExt = '') {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = `${baseNoExt}${ext}`;
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

function toLocalImageWebPath(filePath = '') {
  const rel = path.relative(LEGACY_DATA_DIR, filePath).split(path.sep).join('/');
  return `/data/${rel}`;
}

function uniqueStrings(values = []) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function localImageUrlsFromItem(item = {}) {
  return uniqueStrings([
    ...(Array.isArray(item?.imageUrlsLocal) ? item.imageUrlsLocal : []),
    ...((Array.isArray(item?.imageUrls) ? item.imageUrls : []).filter((x) => !isHttpUrl(x))),
    ...(!isHttpUrl(item?.imageUrl) && item?.imageUrl ? [item.imageUrl] : [])
  ]);
}

function remoteImageUrlsFromItem(item = {}) {
  const explicit = uniqueStrings(Array.isArray(item?.imageUrlsRemote) ? item.imageUrlsRemote : []);
  if (explicit.length) return explicit.filter((x) => isHttpUrl(x));

  return uniqueStrings([
    ...((Array.isArray(item?.imageUrls) ? item.imageUrls : []).filter((x) => isHttpUrl(x))),
    ...(isHttpUrl(item?.imageUrl) ? [item.imageUrl] : [])
  ]);
}

function applyListingImageFields(item = {}, { localUrls = [], remoteUrls = [] } = {}) {
  const local = uniqueStrings(localUrls);
  const remote = uniqueStrings(remoteUrls.filter((x) => isHttpUrl(x)));
  const display = local.length ? local : remote;

  item.imageUrlsLocal = local;
  item.imageUrlsRemote = remote;
  item.imageUrls = display;
  item.imageUrl = display[0] || null;
}

function normalizeListingImageFields(listings = []) {
  if (!Array.isArray(listings)) return;
  for (const item of listings) {
    applyListingImageFields(item, {
      localUrls: localImageUrlsFromItem(item),
      remoteUrls: remoteImageUrlsFromItem(item)
    });
  }
}

function resolveMaxArchivedImagesPerListing(config = {}) {
  const value = Number(config?.media?.maxArchivedImagesPerListing ?? 5);
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(12, Math.trunc(value)));
}

async function localizeVisibleListingImages(listings = [], config = {}) {
  if (!Array.isArray(listings) || !listings.length) return;

  const imagesDir = path.join(DATA_DIR, 'images');
  await fs.mkdir(imagesDir, { recursive: true });

  const urlToLocal = new Map();
  const maxPerListing = resolveMaxArchivedImagesPerListing(config);

  for (const item of listings) {
    const preservedLocal = localImageUrlsFromItem(item);
    const remoteUrls = remoteImageUrlsFromItem(item).slice(0, maxPerListing);

    if (!remoteUrls.length) {
      applyListingImageFields(item, { localUrls: preservedLocal, remoteUrls: [] });
      continue;
    }

    const localized = [];

    for (const sourceUrl of remoteUrls) {
      if (urlToLocal.has(sourceUrl)) {
        localized.push(urlToLocal.get(sourceUrl));
        continue;
      }

      const hash = crypto.createHash('sha1').update(sourceUrl).digest('hex').slice(0, 24);
      const baseNoExt = path.join(imagesDir, hash);

      try {
        const existing = await findExistingImageFile(baseNoExt);
        if (existing) {
          const localPath = toLocalImageWebPath(existing);
          urlToLocal.set(sourceUrl, localPath);
          localized.push(localPath);
          continue;
        }

        const { buffer, contentType } = await fetchBinary(sourceUrl);
        const ext = imageExtFromUrl(sourceUrl) || imageExtFromContentType(contentType) || '.jpg';
        const filePath = `${baseNoExt}${ext}`;
        await fs.writeFile(filePath, buffer);

        const localPath = toLocalImageWebPath(filePath);
        urlToLocal.set(sourceUrl, localPath);
        localized.push(localPath);
      } catch {
        // Keep the remote URL as fallback if archiving fails.
      }
    }

    applyListingImageFields(item, {
      localUrls: [...preservedLocal, ...localized].slice(0, maxPerListing),
      remoteUrls
    });
  }
}

function chfToNumber(str = '') {
  const cleaned = str.replace(/[^0-9]/g, '');
  return cleaned ? Number(cleaned) : null;
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toDurationMinutesOrNull(value) {
  const n = toNumberOrNull(value);
  return n != null && n > 0 ? n : null;
}

function sanitizeTravelText(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const m = text.match(/(\d+)/);
  if (!m) return text;
  return Number(m[1]) > 0 ? text : '';
}

function publishedAgeDays(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function resolveMaxPublishedAgeDays(config) {
  const val = config?.filters?.maxPublishedAgeDays;
  if (val === null || val === undefined || val === '') return 30;
  const explicit = Number(val);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return 30;
}

function publicationEligibility(item, config) {
  const maxAgeDays = resolveMaxPublishedAgeDays(config);
  const ageDays = publishedAgeDays(item?.publishedAt);

  if (maxAgeDays == null) {
    return { eligible: true, ageDays, maxAgeDays: null };
  }

  if (ageDays == null) {
    return { eligible: true, ageDays: null, maxAgeDays };
  }

  return {
    eligible: ageDays <= maxAgeDays,
    ageDays,
    maxAgeDays
  };
}

function locationEligibility() {
  return { eligible: true, reason: '' };
}

function parseRooms(text = '') {
  // Try specific "X pièce(s)" / "X½ pièces" / "X Zimmer" patterns first
  const specific = text.match(/(\d+(?:[.,½]\d*)?)\s*(?:½\s*)?(?:pi[eè]ces?|zimmer|rooms?|½)/i);
  if (specific) {
    return Number(specific[1].replace(',', '.').replace('½', '.5'));
  }
  // Try "X.5" or "X,5" standalone (common Swiss format like "3.5" or "2,5")
  const decimal = text.match(/\b(\d+[.,]5)\b/);
  if (decimal) {
    return Number(decimal[1].replace(',', '.'));
  }
  return null;
}

function slugToTitle(href = '') {
  const withoutQuery = href.split('?')[0];
  const bits = withoutQuery.split('/').filter(Boolean);
  const tail = bits[bits.length - 1] || '';
  const noId = tail.replace(/-\d+$/, '');
  return noId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function extractAreaAfterSwissZip(value = '') {
  const m = String(value || '').match(/\b\d{4}\s+(.+)$/);
  if (!m?.[1]) return '';
  return String(m[1]).split(',')[0].trim();
}

function inferAreaFromAddress(address = '', fallback = '') {
  const parts = String(address || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return fallback;

  const first = parts[0];
  if (!/\d/.test(first)) return first;

  const withZip = parts.find((p) => /\b\d{4}\b/.test(p));
  if (withZip) {
    const city = extractAreaAfterSwissZip(withZip);
    if (city) return city;
  }

  return fallback;
}

function inferAreaFromAddressStrict(address = '') {
  const parts = String(address || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return '';

  const first = parts[0];
  if (!/\d/.test(first)) return first;

  const withZip = parts.find((p) => /\b\d{4}\b/.test(p));
  if (withZip) {
    const city = extractAreaAfterSwissZip(withZip);
    if (city) return city;
  }

  return '';
}

function parsePrice(raw = '') {
  const text = stripTags(raw);
  const rentMatch = text.match(/CHF\s*([\d'\s]+)\.?-?\/?mois/i);
  const chargesMatch = text.match(/\(\+\s*([\d'\s]+)\.?-?\s*charges\)/i);
  const rentChf = rentMatch ? chfToNumber(rentMatch[1]) : null;
  const chargesChf = chargesMatch ? chfToNumber(chargesMatch[1]) : 0;
  const totalChf = rentChf != null ? rentChf + (chargesChf || 0) : null;
  return { priceRaw: text, rentChf, chargesChf, totalChf };
}

function toAbsoluteUrl(value = '') {
  const clean = decodeHtml(value || '');
  if (!clean) return null;
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  if (clean.startsWith('/')) return `https://www.immobilier.ch${clean}`;
  return `https://www.immobilier.ch/${clean}`;
}

function toAbsoluteUrlForHost(value = '', host = '') {
  const clean = decodeHtml(value || '');
  if (!clean) return null;
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  const base = String(host || '').replace(/\/$/, '');
  if (!base) return clean;
  if (clean.startsWith('/')) return `${base}${clean}`;
  return `${base}/${clean}`;
}

function computeScore(item, config) {
  const budget = config.filters?.maxTotalChf ?? 1400;
  const minRooms = config.filters?.minRoomsPreferred ?? 2;
  let score = 0;
  const reasons = [];

  const listingStage = String(item?.listingStage || '').toLowerCase();
  if (listingStage === 'off_market') {
    score += 20;
    reasons.push('Stage: +20 (signal off-market)');
  } else if (listingStage === 'early_market') {
    score += 8;
    reasons.push('Stage: +8 (direct régie)');
  }

  if (item.totalChf != null) {
    const total = Number(item.totalChf);

    if (total <= budget) {
      score += 45;
      reasons.push(`Budget: +45 (<= CHF ${budget})`);
    } else {
      const over = total - budget;
      const penalty = Math.max(1, Math.floor(Math.pow(over / 50, 1.12)));
      const budgetScore = Math.max(-20, 45 - penalty);
      score += budgetScore;
      reasons.push(`Budget: ${budgetScore >= 0 ? '+' : ''}${budgetScore} (CHF +${Math.round(over)} au-dessus du budget)`);
    }
  } else {
    reasons.push('Budget: 0 (loyer total inconnu)');
  }

  const rooms = item.rooms ?? 0;
  if (rooms >= minRooms) {
    score += 30;
    reasons.push(`Pièces: +30 (${rooms} >= ${minRooms})`);
  } else if (rooms >= 1.5) {
    score += 15;
    reasons.push(`Pièces: +15 (${rooms}, option transition)`);
  } else {
    score += 5;
    reasons.push(`Pièces: +5 (petite surface)`);
  }

  if (/studio/i.test(item.objectType || '')) {
    score -= 4;
    reasons.push('Type: -4 (studio)');
  }

  const areaKey = normalizeAreaToken(item.area || '');
  if (areaKey === 'vevey') {
    score += 5;
    reasons.push('Zone: +5 (Vevey)');
  }
  if (areaKey === 'la tour peilz') {
    score += 4;
    reasons.push('Zone: +4 (La Tour-de-Peilz)');
  }
  if (areaKey === 'corseaux') {
    score += 4;
    reasons.push('Zone: +4 (Corseaux)');
  }
  if (areaKey === 'corsier sur vevey') {
    score += 4;
    reasons.push('Zone: +4 (Corsier-sur-Vevey)');
  }

  const transit = toPositiveNumber(item.transitMinutes);
  const drive = toPositiveNumber(item.driveMinutes);
  const referenceTravel = transit ?? drive;

  if (referenceTravel != null) {
    const over = Math.max(0, referenceTravel - 30);
    const malus = Math.floor(over / 5);

    if (malus > 0) {
      score -= malus;
      reasons.push(`Trajet Liip: -${malus} (${Math.round(referenceTravel)} min, -1 pt / 5 min au-delà de 30)`);
    } else {
      reasons.push(`Trajet Liip: +0 (${Math.round(referenceTravel)} min)`);
    }
  } else {
    reasons.push('Trajet Liip: 0 (durée inconnue)');
  }

  return { score, reasons };
}

function derivePriority(item, config) {
  const listingStage = String(item?.listingStage || '').toLowerCase();
  if (listingStage === 'off_market') return 'A';
  if (listingStage === 'early_market') return 'A-';

  const budget = config.filters?.maxTotalChf ?? 1400;
  const hardBudget = config.filters?.maxTotalHardChf ?? 1550;
  const minRooms = config.filters?.minRoomsPreferred ?? 2;
  const rooms = item.rooms ?? 0;
  const total = item.totalChf ?? 999999;
  const isStudio = /studio/i.test(item.objectType || '');

  if (total <= budget && rooms >= minRooms) return 'A';
  if (total <= budget + 80 && rooms >= minRooms) return 'A-';
  if (total <= hardBudget && rooms >= minRooms) return 'A-';
  if (isStudio || rooms < minRooms) return 'B';
  return 'B';
}

function isLikelyResidentialListing(item = {}) {
  const text = `${item.objectType || ''} ${item.title || ''}`.toLowerCase();
  const url = String(item?.url || '').toLowerCase();

  if (/\/location\/(parking|local|commerce|bureau|terrain)\//i.test(url)) return false;
  if (/parking|garage|place de parc|place ouverte|d[eé]pot|surface commerciale|bureau|commerce|arcade|terrain|atelier/.test(text)) {
    return false;
  }

  if (/appartement|studio|loft|duplex|attique|maison|pi[eè]ces?/.test(text)) return true;

  const rooms = toPositiveNumber(item?.rooms);
  return rooms != null && rooms > 0;
}

function isExcludedType(item, config) {
  const text = `${item.objectType || ''} ${item.title || ''}`.toLowerCase();
  const keywords = config.filters?.excludedObjectTypeKeywords || ['chambre', 'colocation', 'wg'];
  return keywords.some((k) => text.includes(String(k).toLowerCase()));
}

function isSizeEligible(item, config) {
  const minRooms = Number(config.filters?.minRoomsPreferred ?? 2);
  const minSurface = Number(config.filters?.minSurfaceM2Preferred ?? 0);
  const minSurfaceFallback = Number(config.filters?.minSurfaceM2Fallback ?? 0);
  const studioAllowed = !!config.filters?.allowStudioTransition;
  const allowMissingSurface = config.filters?.allowMissingSurface !== false;

  const rooms = Number(item.rooms ?? 0);
  const surface = Number(item.surfaceM2 ?? 0);
  const hasSurface = Number.isFinite(item.surfaceM2) && item.surfaceM2 > 0;

  const descriptor = `${item?.objectType || ''} ${item?.title || ''}`.toLowerCase();
  const looksResidential = /appartement|studio|loft|duplex|attique|maison|pi[eè]ces?/.test(descriptor);

  // Guardrail: invalid/missing room count should not qualify as "plan B" unless clearly residential.
  if (!Number.isFinite(rooms) || rooms <= 0) {
    return studioAllowed && looksResidential;
  }

  const meetsRooms = rooms >= minRooms;
  const isBelowRooms = rooms < minRooms;

  // Plan B (studio/transition): below min rooms but allowed - skip surface check
  if (isBelowRooms && studioAllowed) return true;

  // If minSurfaceFallback is set, use OR logic: rooms >= minRooms OR surface >= fallback
  if (minSurfaceFallback > 0) {
    const surfaceFallbackOk = hasSurface && surface >= minSurfaceFallback;
    if (meetsRooms || surfaceFallbackOk) return true;
    return false;
  }

  if (!meetsRooms) return false;

  if (!Number.isFinite(minSurface) || minSurface <= 0) return true;

  // If surface is missing, defer to allowMissingSurface setting
  if (!hasSurface) return allowMissingSurface;

  return surface >= minSurface;
}

function isPearl(item, config) {
  const pearlCfg = config.filters?.pearl || {};
  if (pearlCfg.enabled === false) return false;

  const hardBudget = config.filters?.maxTotalHardChf ?? 1450;
  const cap = config.filters?.maxPearlTotalChf ?? 1550;
  const total = item.totalChf;
  if (total == null || total <= hardBudget || total > cap) return false;

  const minRooms = pearlCfg.minRooms ?? 2;
  const minSurface = pearlCfg.minSurfaceM2 ?? 50;
  const rooms = item.rooms ?? 0;
  const surface = item.surfaceM2 ?? 0;
  if (rooms < minRooms || surface < minSurface) return false;

  const text = `${item.title || ''} ${item.objectType || ''} ${item.address || ''}`.toLowerCase();
  const keywords = Array.isArray(pearlCfg.keywords) && pearlCfg.keywords.length
    ? pearlCfg.keywords
    : ['renove', 'rénové', 'balcon', 'terrasse', 'vue', 'quartier paisible', 'lac', 'centre'];
  const minHits = pearlCfg.minHits ?? 1;
  const hits = keywords.filter((s) => text.includes(String(s).toLowerCase())).length;

  return hits >= minHits;
}

function normalizeStatus(status = '') {
  const s = String(status || '').trim();

  if (!s || s === 'À contacter') return 'À contacter';
  if (['Visite', 'Visite demandée', 'Visite planifiée', 'Visité'].includes(s)) return 'Visite';
  if (['Dossier', 'Dossier prêt à envoyer', 'Dossier envoyé'].includes(s)) return 'Dossier';
  if (['Relance', 'Relance J+2'].includes(s)) return 'Relance';
  if (['Accepté', 'Refusé', 'Sans réponse'].includes(s)) return s;

  return 'À contacter';
}

function normalizeDateParts(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  let y = Number(year);

  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  if (y < 100) y += 2000;
  if (y !== 2026) return null;

  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

function isStrictEntryDate(v = '') {
  return /^\d{2}\.\d{2}\.2026$/.test(String(v || '').trim());
}

function parseDateFromText(text = '') {
  const t = String(text || '').toLowerCase();
  if (!t) return null;

  const numeric = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (numeric) {
    const date = normalizeDateParts(numeric[1], numeric[2], numeric[3]);
    if (date) return date;
  }

  const monthMap = {
    janvier: 1,
    fevrier: 2,
    février: 2,
    mars: 3,
    avril: 4,
    mai: 5,
    juin: 6,
    juillet: 7,
    aout: 8,
    août: 8,
    septembre: 9,
    octobre: 10,
    novembre: 11,
    decembre: 12,
    décembre: 12
  };

  const named = t.match(/(\d{1,2})(?:er)?\s+(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\s+(\d{4})/i);
  if (named) {
    const month = monthMap[named[2].toLowerCase()];
    const date = normalizeDateParts(named[1], month, named[3]);
    if (date) return date;
  }

  return null;
}

function extractMoveInDateFromAdditionalInfo(text = '') {
  const clean = stripTags(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!clean) return null;

  if (!/(date\s+d['']?entr(?:é|e)e|disponibilit(?:é|e)|disponible|a\s+partir|à\s+partir)/i.test(clean)) {
    return null;
  }

  return parseDateFromText(clean);
}

function parseMoveInDateFromObjectApi(payload) {
  const extraProperties = Array.isArray(payload?.extraProperties) ? payload.extraProperties : [];

  for (const line of extraProperties) {
    const date = extractMoveInDateFromAdditionalInfo(line);
    if (isStrictEntryDate(date)) return date;
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeAddressPart(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bCH-\d{4}\b/gi, ' ')
    .replace(/\bVD\b/gi, ' ')
    .trim();
}

function buildListingAddressQuery(item) {
  const addressRaw = sanitizeAddressPart(item.address || '');
  const area = sanitizeAddressPart(item.area || '');

  if (addressRaw) {
    return [addressRaw, 'Suisse'].filter(Boolean).join(', ');
  }

  if (area) {
    return [area, 'Suisse'].filter(Boolean).join(', ');
  }

  return '';
}

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return 6371 * c;
}

function isCacheFresh(entry) {
  if (!entry || !entry.updatedAt) return false;
  return Date.now() - new Date(entry.updatedAt).getTime() <= TRAVEL_CACHE_TTL_MS;
}

function getCachedRouteMinutes(routeCache, key) {
  const entry = routeCache?.[key];
  if (!entry) return { hasValue: false, minutes: null, fresh: false };
  return {
    hasValue: true,
    minutes: toDurationMinutesOrNull(entry.minutes),
    fresh: isCacheFresh(entry)
  };
}

function setCachedRouteMinutes(routeCache, key, minutes) {
  routeCache[key] = {
    minutes: toDurationMinutesOrNull(minutes),
    updatedAt: new Date().toISOString()
  };
}

function parseTransportDurationToMinutes(duration = '') {
  const m = String(duration || '').match(/(\d{2})d(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;

  const days = Number(m[1]);
  const hours = Number(m[2]);
  const mins = Number(m[3]);
  const secs = Number(m[4]);

  if (![days, hours, mins, secs].every(Number.isFinite)) return null;

  const total = days * 24 * 60 + hours * 60 + mins + Math.round(secs / 60);
  return total > 0 ? total : null;
}

function buildCoordRouteKey(prefix, a, b) {
  const one = `${Number(a.lat).toFixed(5)},${Number(a.lon).toFixed(5)}`;
  const two = `${Number(b.lat).toFixed(5)},${Number(b.lon).toFixed(5)}`;
  return `${prefix}:${one}->${two}`;
}

function buildAddressRouteKey(prefix, from, to) {
  return `${prefix}:${String(from || '').toLowerCase()}->${String(to || '').toLowerCase()}`;
}

function resolveNextMondayDateIso(referenceDate = new Date()) {
  const now = new Date(referenceDate);
  const day = now.getDay(); // 0 (Sun) ... 6 (Sat)
  const delta = (1 - day + 7) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + delta);
  return monday.toISOString().slice(0, 10);
}

function resolveTransitReference() {
  return {
    date: resolveNextMondayDateIso(),
    time: '08:00',
    transportations: 'train',
    cachePolicyKey: 'monday-0800-train'
  };
}

async function fetchDrivingMinutes(workCoords, listingCoords, routeCache) {
  if (!workCoords || !listingCoords) return null;

  const key = buildCoordRouteKey('drive', workCoords, listingCoords);
  const cached = getCachedRouteMinutes(routeCache, key);
  if (cached.fresh && cached.minutes != null) return cached.minutes;

  try {
    const payload = await fetchJson(
      `https://router.project-osrm.org/route/v1/driving/${workCoords.lon},${workCoords.lat};${listingCoords.lon},${listingCoords.lat}?overview=false`
    );

    const seconds = Number(payload?.routes?.[0]?.duration);
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null;
    setCachedRouteMinutes(routeCache, key, minutes);
    return minutes;
  } catch {
    return cached.hasValue ? cached.minutes : null;
  }
}

async function fetchTransitMinutes(workAddress, listingAddress, routeCache) {
  if (!workAddress || !listingAddress) return null;

  const transitRef = resolveTransitReference();
  const key = buildAddressRouteKey(`transit:${transitRef.cachePolicyKey}`, listingAddress, workAddress);
  const cached = getCachedRouteMinutes(routeCache, key);
  if (cached.fresh && cached.minutes != null) return cached.minutes;

  try {
    const payload = await fetchJson(
      `https://transport.opendata.ch/v1/connections?limit=1&from=${encodeURIComponent(listingAddress)}&to=${encodeURIComponent(workAddress)}&date=${encodeURIComponent(transitRef.date)}&time=${encodeURIComponent(transitRef.time)}&transportations=${encodeURIComponent(transitRef.transportations)}`
    );

    const duration = payload?.connections?.[0]?.duration;
    const minutes = parseTransportDurationToMinutes(duration);
    setCachedRouteMinutes(routeCache, key, minutes);
    return minutes;
  } catch {
    return cached.hasValue ? cached.minutes : null;
  }
}

let lastGeocodeRequestAt = 0;

async function geocodeAddress(query, geocodeCache) {
  if (!query) return null;

  const key = query.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(geocodeCache, key)) {
    const cached = geocodeCache[key];
    if (cached && typeof cached === 'object' && Number.isFinite(Number(cached.lat)) && Number.isFinite(Number(cached.lon))) {
      return { lat: Number(cached.lat), lon: Number(cached.lon) };
    }
  }

  const parseLatLon = (latValue, lonValue) => {
    const lat = Number(latValue);
    const lon = Number(lonValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  };

  const elapsed = Date.now() - lastGeocodeRequestAt;
  if (elapsed < 1100) {
    await sleep(1100 - elapsed);
  }

  try {
    const payload = await fetchJson(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
    );
    lastGeocodeRequestAt = Date.now();

    if (Array.isArray(payload) && payload.length) {
      const point = parseLatLon(payload[0]?.lat, payload[0]?.lon);
      if (point) {
        geocodeCache[key] = point;
        return point;
      }
    }
  } catch {
    // fallback below
  }

  try {
    const photon = await fetchJson(
      `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`
    );

    const coords = photon?.features?.[0]?.geometry?.coordinates;
    const point = Array.isArray(coords) ? parseLatLon(coords[1], coords[0]) : null;
    if (point) {
      geocodeCache[key] = point;
      return point;
    }

    return null;
  } catch {
    return undefined;
  }
}

async function computeDistanceFromWork(item, workCoords, geocodeCache) {
  if (!workCoords) {
    return { computed: false, distanceKm: null, distanceText: '', listingAddress: '', listingCoords: null };
  }

  const listingAddress = buildListingAddressQuery(item);
  if (!listingAddress) {
    return { computed: false, distanceKm: null, distanceText: '', listingAddress: '', listingCoords: null };
  }

  const listingCoords = await geocodeAddress(listingAddress, geocodeCache);
  if (!listingCoords || typeof listingCoords !== 'object') {
    return { computed: false, distanceKm: null, distanceText: '', listingAddress, listingCoords: null };
  }

  const rawKm = haversineKm(workCoords, listingCoords);
  const distanceKm = Number(rawKm.toFixed(1));

  return {
    computed: true,
    distanceKm,
    distanceText: `${distanceKm.toFixed(1)} km`,
    listingAddress,
    listingCoords
  };
}

function mergeNotesWithEntryDate(notes = '', moveInDate = null) {
  const current = String(notes || '');

  if (!moveInDate) {
    return current.replace(/Entr(?:é|e)e\s*:[^\n]*/i, '').replace(/\n{2,}/g, '\n').trim();
  }

  const line = `Entrée : ${moveInDate}`;

  if (/Entr(?:é|e)e\s*:/i.test(current)) {
    return current.replace(/Entr(?:é|e)e\s*:[^\n]*/i, line).trim();
  }

  return current ? `${current}\n${line}`.trim() : line;
}

async function fetchMoveInDate(objectId) {
  if (!objectId) return { fetched: false, date: null };

  try {
    const payload = await fetchJson(`https://www.immobilier.ch/api/objects/${objectId}?lang=fr`);
    return {
      fetched: true,
      date: parseMoveInDateFromObjectApi(payload)
    };
  } catch {
    return { fetched: false, date: null };
  }
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml'
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} on ${url}`));
            return;
          }
          resolve(raw);
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error(`Timeout on ${url}`));
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          accept: 'application/json,text/plain,*/*'
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} on ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(new Error(`Invalid JSON on ${url}: ${err.message}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error(`Timeout on ${url}`));
    });
  });
}

function fetchHtmlWithRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml'
        }
      },
      async (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', async () => {
          const code = Number(res.statusCode || 0);

          if (code >= 300 && code < 400 && res.headers.location) {
            if (maxRedirects <= 0) {
              reject(new Error(`Too many redirects on ${url}`));
              return;
            }

            try {
              const nextUrl = new URL(res.headers.location, url).toString();
              const redirected = await fetchHtmlWithRedirects(nextUrl, maxRedirects - 1);
              resolve(redirected);
            } catch (err) {
              reject(err);
            }
            return;
          }

          if (code >= 400) {
            reject(new Error(`HTTP ${code} on ${url}`));
            return;
          }

          resolve({ html: raw, finalUrl: url, statusCode: code });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Timeout on ${url}`));
    });
  });
}

function shouldRetryAnibisRequest(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;

  return [
    'timeout',
    'timed out',
    'econnreset',
    'socket hang up',
    'eai_again',
    'enotfound',
    '503',
    '502',
    '504'
  ].some((token) => msg.includes(token));
}

async function fetchHtmlWithRedirectsRetry(url, options = {}) {
  const attempts = Math.max(1, Number(options?.attempts ?? 3));
  const maxRedirects = Math.max(1, Number(options?.maxRedirects ?? 5));
  const baseDelayMs = Math.max(0, Number(options?.baseDelayMs ?? 1200));

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchHtmlWithRedirects(url, maxRedirects);
    } catch (err) {
      lastError = err;

      const retryable = shouldRetryAnibisRequest(err);
      if (!retryable || attempt >= attempts) {
        throw err;
      }

      const waitMs = baseDelayMs * attempt;
      await sleep(waitMs);
    }
  }

  throw lastError || new Error(`Failed to fetch ${url}`);
}

function parseAnibisSearchDataFromHtml(html = '') {
  const nextDataMatch = String(html || '').match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!nextDataMatch?.[1]) return null;

  try {
    const nextData = JSON.parse(nextDataMatch[1]);
    const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
    if (!Array.isArray(queries)) return null;

    const payload = queries.find((q) => JSON.stringify(q?.queryKey || '').includes('SearchListingsByConstraints'));
    return payload?.state?.data || null;
  } catch {
    return null;
  }
}

function parseAnibisPrice(formattedPrice = '') {
  const text = stripTags(String(formattedPrice || ''));
  if (!text || /sur\s+demande|gratis|gratuit/i.test(text)) return null;
  return toPositiveNumber(chfToNumber(text));
}

function parseAnibisSurfaceM2(...texts) {
  for (const text of texts) {
    const m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*m(?:2|²)/i);
    if (m?.[1]) {
      const n = Number(m[1].replace(',', '.'));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function isAnibisRentalListing(raw, frSlug, title, description, formattedPriceText) {
  const haystack = normalizeKeyText([
    frSlug,
    title,
    description,
    raw?.body,
    raw?.title
  ].filter(Boolean).join(' '));

  const saleSignals = [
    'a vendre',
    'a-vendre',
    'vente',
    'acheter',
    'a acheter',
    'a-acheter'
  ];

  if (saleSignals.some((signal) => haystack.includes(signal))) {
    return false;
  }

  const rentalSignals = [
    'a louer',
    'a-louer',
    'location',
    'sous location',
    'sous-location',
    'reprise de bail',
    'reprise-de-bail'
  ];

  const hasRentalSignal = rentalSignals.some((signal) => haystack.includes(signal));
  const isMonthlyPrice = /\bpar\s+mois\b|\/\s*mois\b/i.test(formattedPriceText);

  return hasRentalSignal || isMonthlyPrice;
}

function parseAnibisListing(raw, fallbackAreaLabel = '') {
  const sourceId = String(raw?.listingID || '').trim();
  if (!sourceId) return null;

  const categoryId = String(raw?.primaryCategory?.categoryID || '').toLowerCase();
  if (categoryId !== 'realestate') return null;

  const frSlug = String(raw?.seoInformation?.frSlug || '').trim();
  if (!frSlug.includes('/immobilier/appartements/')) return null;

  const listingPath = frSlug.replace(/^\/+|\/+$/g, '');
  const url = listingPath ? `https://www.anibis.ch/fr/vi/${listingPath}/${sourceId}` : null;

  const title = stripTags(raw?.title || 'Appartement');
  const description = stripTags(raw?.body || '');
  const formattedPriceText = stripTags(raw?.formattedPrice || '');

  if (!isAnibisRentalListing(raw, frSlug, title, description, formattedPriceText)) {
    return null;
  }

  const rooms = parseRooms(title) ?? parseRooms(description);
  const surfaceM2 = parseAnibisSurfaceM2(title, description);

  const postcode = String(raw?.postcodeInformation?.postcode || '').trim();
  const city = String(raw?.postcodeInformation?.locationName || fallbackAreaLabel || '').trim();
  const canton = String(raw?.postcodeInformation?.canton?.shortName || '').trim();
  const address = [postcode, city].filter(Boolean).join(' ').trim();

  const totalChf = parseAnibisPrice(raw?.formattedPrice);
  const imageUrls = [...new Set([
    toAbsoluteUrlForHost(raw?.thumbnail?.normalRendition?.src || '', 'https://www.anibis.ch'),
    toAbsoluteUrlForHost(raw?.thumbnail?.retinaRendition?.src || '', 'https://www.anibis.ch')
  ].filter(Boolean))].slice(0, 6);

  return {
    id: `anibis:${sourceId}`,
    sourceId,
    url,
    title,
    objectType: rooms != null ? `Appartement ${rooms} pièces` : 'Appartement',
    address,
    area: city || fallbackAreaLabel || canton,
    rooms,
    surfaceM2,
    priceRaw: formattedPriceText,
    rentChf: totalChf,
    chargesChf: 0,
    totalChf,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    source: 'anibis.ch',
    publishedAt: raw?.timestamp || null
  };
}

function isStoredAnibisSaleListing(item) {
  if (String(item?.source || '') !== 'anibis.ch') return false;

  const haystack = normalizeKeyText([
    item?.title,
    item?.url,
    item?.notes,
    item?.priceRaw
  ].filter(Boolean).join(' '));

  return [
    'a vendre',
    'a-vendre',
    'vente',
    'acheter',
    'a acheter',
    'a-acheter'
  ].some((signal) => haystack.includes(signal));
}

function withPageParam(url, page) {
  const u = new URL(url);
  if (page > 1) {
    u.searchParams.set('page', String(page));
  } else {
    u.searchParams.delete('page');
  }
  return u.toString();
}

async function scrapeAnibisQuery(query, fallbackAreaLabel = '', maxPages = 2, requestOptions = {}) {
  const firstUrl = `https://www.anibis.ch/fr/q?query=${encodeURIComponent(query)}`;
  const firstRes = await fetchHtmlWithRedirectsRetry(firstUrl, requestOptions);
  const firstData = parseAnibisSearchDataFromHtml(firstRes.html);

  if (!firstData) return [];

  const perPage = Math.max(1, Number(firstData?.listings?.edges?.length || 30));
  const totalCount = Math.max(0, Number(firstData?.listings?.totalCount || perPage));
  const pages = Math.max(1, Math.min(Math.ceil(totalCount / perPage), Number(maxPages) || 1));

  const out = [];
  const parsePageData = (data) => {
    const edges = Array.isArray(data?.listings?.edges) ? data.listings.edges : [];
    for (const edge of edges) {
      const parsed = parseAnibisListing(edge?.node, fallbackAreaLabel);
      if (parsed) out.push(parsed);
    }
  };

  parsePageData(firstData);

  for (let page = 2; page <= pages; page += 1) {
    try {
      const pageUrl = withPageParam(firstRes.finalUrl, page);
      const pageRes = await fetchHtmlWithRedirectsRetry(pageUrl, requestOptions);
      const pageData = parseAnibisSearchDataFromHtml(pageRes.html);
      parsePageData(pageData);
    } catch (err) {
      console.error(`WARN anibis query="${query}" page=${page}: ${err.message}`);
    }
  }

  return out;
}

async function scrapeAnibisListings(config) {
  const out = [];
  const areas = Array.isArray(config?.areas) ? config.areas : [];
  const targetAreaSet = buildTargetAreaSet(areas);
  const maxPagesPerArea = Math.max(1, Number(config?.anibis?.maxPagesPerArea ?? 2));
  const querySuffix = String(config?.anibis?.querySuffix || 'appartement louer').trim();

  const requestOptions = {
    attempts: Math.max(1, Number(config?.anibis?.requestRetries ?? 3)),
    maxRedirects: Math.max(1, Number(config?.anibis?.maxRedirects ?? 5)),
    baseDelayMs: Math.max(0, Number(config?.anibis?.retryBackoffMs ?? 1200))
  };

  for (const area of areas) {
    const areaLabel = String(area?.label || '').trim();
    if (!areaLabel) continue;

    const query = `${areaLabel} ${querySuffix}`.trim();

    try {
      const listings = await scrapeAnibisQuery(query, areaLabel, maxPagesPerArea, requestOptions);
      for (const item of listings) {
        if (!isTargetAreaCity(item.area || '', targetAreaSet)) continue;
        out.push(item);
      }
    } catch (err) {
      console.error(`WARN anibis area="${areaLabel}": ${err.message}`);
    }
  }

  return out;
}

function parseListingsFromHtml(html, areaLabel) {
  const blocks = html.match(/<div id="filter-item-\d+" class="filter-item"[\s\S]*?(?=<div id="filter-item-|<immo-ads id=|$)/g) || [];
  const out = [];

  for (const block of blocks) {
    const idMatch = block.match(/id="filter-item-(\d+)"/);
    const hrefMatch = block.match(/id="link-result-item-\d+"[^>]*href="([^"]+)"/);
    const titlePriceMatch = block.match(/<strong class="title">([\s\S]*?)<\/strong>/);
    const objectTypeMatch = block.match(/<p class="object-type">([\s\S]*?)<\/p>/);
    const addressMatch = block.match(/<p class="object-type">[\s\S]*?<\/p>\s*<p>([\s\S]*?)<\/p>/);
    const areaMatch = block.match(/class="space">([\d.,'\s]+)\s*m<sup>2<\/sup>/i);
    const imageMatches = [...block.matchAll(/<img[^>]+data-src="([^"]+)"[^>]*>/gi)];
    const agencyLinkMatch = block.match(/id="link-result-agency-\d+"[^>]*href="([^"]+)"/i);
    const agencyAltMatch = block.match(/id="link-result-agency-\d+"[^>]*>[\s\S]*?<img[^>]*alt="([^"]+)"/i);

    if (!idMatch || !hrefMatch) continue;

    const id = idMatch[1];
    const href = decodeHtml(hrefMatch[1]);
    if (/\/vendre\//i.test(href)) continue;

    const url = href.startsWith('http') ? href : `https://www.immobilier.ch${href}`;
    if (/\/vendre\//i.test(url)) continue;

    const imageUrls = [...new Set(
      imageMatches
        .map((m) => toAbsoluteUrl(m[1]))
        .filter((x) => x && !/logo[-_]?small|\/logo\./i.test(String(x)))
    )].slice(0, 6);
    const imageUrl = imageUrls[0] || null;
    const objectType = stripTags(objectTypeMatch?.[1] || 'Appartement');
    const rooms = parseRooms(objectType);
    const surfaceM2 = areaMatch ? Number(areaMatch[1].replace(/['\s]/g, '').replace(',', '.')) : null;
    const address = stripTags(addressMatch?.[1] || '');
    const inferredArea = inferAreaFromAddress(address, areaLabel);
    const agencyUrl = toAbsoluteUrlForHost(agencyLinkMatch?.[1] || '', 'https://www.immobilier.ch');
    const agencyName = stripTags(agencyAltMatch?.[1] || '');
    const { priceRaw, rentChf, chargesChf, totalChf } = parsePrice(titlePriceMatch?.[1] || '');

    out.push({
      id,
      sourceId: id,
      url,
      title: slugToTitle(href),
      objectType,
      address,
      area: inferredArea,
      rooms,
      surfaceM2,
      priceRaw,
      rentChf,
      chargesChf,
      totalChf,
      imageUrl,
      imageUrls,
      agencyName: agencyName || null,
      agencyUrl: agencyUrl || null,
      providerName: agencyName || null,
      source: 'immobilier.ch',
      publishedAt: null
    });
  }

  return out;
}

function normalizeKeyText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Swiss canton abbreviations used as city suffixes (e.g. "Romont FR", "Sierre VS")
const SWISS_CANTON_CODES = new Set([
  'ag', 'ai', 'ar', 'be', 'bl', 'bs', 'fr', 'ge', 'gl', 'gr',
  'ju', 'lu', 'ne', 'nw', 'ow', 'sg', 'sh', 'so', 'sz', 'tg',
  'ti', 'ur', 'vd', 'vs', 'zg', 'zh'
]);

function normalizeAreaToken(value = '') {
  let token = normalizeKeyText(value)
    .replace(/\bsaint\b/g, 'st')   // Saint-Légier ↔ St-Légier
    .replace(/\bde\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing Swiss canton suffix (e.g. "romont fr" → "romont")
  const parts = token.split(' ');
  if (parts.length > 1 && SWISS_CANTON_CODES.has(parts[parts.length - 1])) {
    parts.pop();
    token = parts.join(' ');
  }

  return token;
}

function resolveNonSpeculativeGroups(config) {
  const configured = Array.isArray(config?.filters?.nonSpeculativeGroups)
    ? config.filters.nonSpeculativeGroups
    : [];

  const source = configured.length ? configured : DEFAULT_NON_SPECULATIVE_GROUPS;
  return source
    .map((x) => normalizeKeyText(String(x || '')))
    .filter(Boolean);
}

function nonSpeculativeEligibility(item, config) {
  const enabled = !!config?.filters?.nonSpeculativeOnly;
  if (!enabled) {
    return { eligible: true, reason: '' };
  }

  const groups = resolveNonSpeculativeGroups(config);
  if (!groups.length) {
    return { eligible: true, reason: '' };
  }

  const haystack = normalizeKeyText([
    item?.providerName,
    item?.agencyName,
    item?.agencyUrl,
    item?.title,
    item?.notes
  ].filter(Boolean).join(' '));

  const eligible = groups.some((token) => haystack.includes(token));
  return {
    eligible,
    reason: eligible ? '' : 'Bailleur hors liste non spéculative'
  };
}

function buildTargetAreaSet(areas = []) {
  const set = new Set();
  const push = (value) => {
    const key = normalizeAreaToken(value);
    if (key) set.add(key);
  };

  for (const area of areas) {
    push(area?.label || '');
    push(area?.slug || '');
  }

  return set;
}

function isTargetAreaCity(city = '', targetAreaSet) {
  if (!targetAreaSet || !targetAreaSet.size) return true;

  const key = normalizeAreaToken(city);
  if (!key) return false;

  return targetAreaSet.has(key);
}

function resolveImmobilierCanton(area = {}, config = {}) {
  const explicit = String(area?.canton || config?.canton || '').trim().toLowerCase();
  if (explicit) return explicit;
  return 'vaud';
}

const IMMOBILIER_SLUG_LEADING_ARTICLES = new Set(['la', 'le', 'les', 'l']);
const IMMOBILIER_SLUG_JOINERS = new Set(['de', 'du', 'des', 'd']);

function normalizeSlugCandidate(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function slugSaintToSt(value = '') {
  return String(value || '').replace(/(^|-)saint(?=-|$)/g, '$1st');
}

function slugStToSaint(value = '') {
  return String(value || '').replace(/(^|-)st(?=-|$)/g, '$1saint');
}

function compactImmobilierSlug(value = '') {
  const tokens = String(value || '').split('-').filter(Boolean);
  if (!tokens.length) return '';

  while (tokens.length && IMMOBILIER_SLUG_LEADING_ARTICLES.has(tokens[0])) {
    tokens.shift();
  }

  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    if (IMMOBILIER_SLUG_JOINERS.has(token)) continue;
    if (token === 'la' && i > 0 && (tokens[i - 1] === 'st' || tokens[i - 1] === 'saint')) continue;

    out.push(token);
  }

  return out.join('-');
}

function buildImmobilierSlugCandidates(area = {}) {
  const ordered = [];
  const seen = new Set();

  const add = (value) => {
    const key = normalizeSlugCandidate(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };

  add(area?.slug || '');
  add(area?.label || '');

  for (let i = 0; i < ordered.length; i += 1) {
    const slug = ordered[i];
    add(slugSaintToSt(slug));
    add(slugStToSaint(slug));

    const compact = compactImmobilierSlug(slug);
    add(compact);
    add(slugSaintToSt(compact));
    add(slugStToSaint(compact));
  }

  return ordered;
}

async function resolveImmobilierSlugForArea(area = {}, config = {}) {
  const canton = resolveImmobilierCanton(area, config);
  const candidates = buildImmobilierSlugCandidates(area);
  const fallback = normalizeSlugCandidate(area?.slug || area?.label || '');
  if (!candidates.length) return fallback;

  const areaTargetSet = buildTargetAreaSet([area]);
  let best = null;

  for (let idx = 0; idx < candidates.length; idx += 1) {
    const slug = candidates[idx];
    const url = `https://www.immobilier.ch/fr/louer/appartement/${canton}/${slug}/page-1`;

    try {
      const html = await fetchHtml(url);
      const items = parseListingsFromHtml(html, area?.label || '');
      if (!items.length) continue;

      let strictMatches = 0;
      let looseMatches = 0;

      for (const item of items) {
        const strictArea = inferAreaFromAddressStrict(item.address || '');
        if (strictArea && isTargetAreaCity(strictArea, areaTargetSet)) {
          strictMatches += 1;
        }
        if (isTargetAreaCity(item.area || '', areaTargetSet)) {
          looseMatches += 1;
        }
      }

      const score = strictMatches * 100 + looseMatches;
      if (!best || score > best.score) {
        best = { slug, score, strictMatches, looseMatches };
      }

      // Fast path: current slug already returns matching city names.
      if (idx === 0 && strictMatches > 0) {
        return slug;
      }
    } catch {
      // try next candidate
    }
  }

  if (best && (best.strictMatches > 0 || best.looseMatches > 0)) {
    return best.slug;
  }

  return candidates[0] || fallback;
}

function resolveFlatfoxAreaTokens(areas = []) {
  const tokens = new Set();

  for (const area of areas) {
    const label = String(area?.label || '').trim();
    const slug = String(area?.slug || '').trim().toLowerCase();

    // Flatfox works best with the original city name (with spaces/accents)
    if (label) tokens.add(label);
    // Also try the slug as fallback
    if (slug) tokens.add(slug.replace(/_/g, '-'));
  }

  return [...tokens];
}

function parseFlatfoxMoveInDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return normalizeDateParts(iso[3], iso[2], iso[1]);
  }

  return parseDateFromText(raw);
}

function parseFlatfoxPriceFromText(text = '') {
  const m = String(text || '').match(/CHF\s*([\d''\s.,]+)/i);
  if (!m) return null;
  return toPositiveNumber(chfToNumber(m[1] || ''));
}

function parseFlatfoxListing(raw, fallbackAreaLabel = '') {
  const sourceId = String(raw?.pk || '').trim();
  if (!sourceId) return null;

  if (String(raw?.offer_type || '').toUpperCase() !== 'RENT') return null;
  if (String(raw?.object_category || '').toUpperCase() !== 'APARTMENT') return null;
  if (String(raw?.status || '').toLowerCase() !== 'act') return null;

  const parsedRooms = toPositiveNumber(String(raw?.number_of_rooms || '').replace(',', '.'));
  const rooms = parsedRooms ?? parseRooms(raw?.short_title || raw?.public_title || '');

  const surfaceM2 = toPositiveNumber(raw?.surface_living) ?? toPositiveNumber(raw?.space_display);

  const rentChf = toPositiveNumber(raw?.rent_net);
  const chargesChf = toPositiveNumber(raw?.rent_charges) ?? 0;
  const gross = toPositiveNumber(raw?.rent_gross);
  const priceDisplay = toPositiveNumber(raw?.price_display);
  const textPrice = parseFlatfoxPriceFromText(raw?.public_title || raw?.description_title || raw?.short_title || '');
  const computedFromNet = rentChf != null ? rentChf + (chargesChf || 0) : null;
  const totalChf = gross ?? priceDisplay ?? computedFromNet ?? textPrice;

  const city = String(raw?.city || fallbackAreaLabel || '').trim();
  const street = String(raw?.street || '').trim();
  const zipcode = raw?.zipcode != null ? String(raw.zipcode).trim() : '';
  const publicAddress = String(raw?.public_address || '').trim();
  const address = publicAddress || [street, [zipcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const imageUrls = [...new Set(
    (Array.isArray(raw?.images) ? raw.images : [])
      .map((img) => {
        if (img && typeof img === 'object') {
          return toAbsoluteUrlForHost(img.url_listing_search || img.url_thumb_m || img.url || '', 'https://flatfox.ch');
        }
        return null;
      })
      .filter(Boolean)
  )].slice(0, 6);

  const agencyName = [raw?.agency?.name, raw?.agency?.name_2]
    .map((x) => stripTags(String(x || '')))
    .filter(Boolean)
    .join(' / ')
    .trim();

  const url = toAbsoluteUrlForHost(raw?.url || raw?.short_url || '', 'https://flatfox.ch');
  const title = stripTags(raw?.description_title || raw?.short_title || slugToTitle(raw?.slug || '') || 'Appartement');

  return {
    id: `flatfox:${sourceId}`,
    sourceId,
    url,
    title,
    objectType: rooms != null ? `Appartement ${rooms} pièces` : (raw?.short_title || 'Appartement'),
    address,
    area: city,
    rooms,
    surfaceM2,
    priceRaw: raw?.public_title || (totalChf != null ? `CHF ${totalChf}/mois` : ''),
    rentChf,
    chargesChf,
    totalChf,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    agencyName: agencyName || null,
    agencyUrl: null,
    providerName: agencyName || null,
    source: 'flatfox.ch',
    movingDateRaw: raw?.moving_date || null,
    publishedAt: raw?.published || raw?.created || null
  };
}

async function scrapeFlatfoxPopularArea(areaToken, fallbackAreaLabel = '', maxPages = 3) {
  const out = [];
  let page = 0;
  let nextUrl = `https://flatfox.ch/api/v1/public-listing/popular/?area=${encodeURIComponent(areaToken)}&limit=100&expand=images`;

  while (nextUrl && page < maxPages) {
    page += 1;

    const payload = await fetchJson(nextUrl);
    const results = Array.isArray(payload?.results) ? payload.results : [];

    for (const entry of results) {
      const parsed = parseFlatfoxListing(entry, fallbackAreaLabel);
      if (parsed) out.push(parsed);
    }

    const next = payload?.next;
    nextUrl = typeof next === 'string' && next.trim() ? next : null;
  }

  return out;
}

async function scrapeFlatfoxListings(config) {
  const out = [];
  const areas = Array.isArray(config?.areas) ? config.areas : [];
  const targetAreaSet = buildTargetAreaSet(areas);
  const tokens = resolveFlatfoxAreaTokens(areas);
  const maxPages = Math.max(1, Number(config?.flatfox?.maxPagesPerArea ?? 3));

  for (const token of tokens) {
    try {
      const items = await scrapeFlatfoxPopularArea(token, '', maxPages);
      for (const item of items) {
        if (!isTargetAreaCity(item.area || '', targetAreaSet)) continue;
        out.push(item);
      }
    } catch (err) {
      console.error(`WARN flatfox area=${token}: ${err.message}`);
    }
  }

  return out;
}

function extractJsonArrayVariable(html = '', variableName = '') {
  const varToken = `var ${variableName}`;
  const idx = String(html || '').indexOf(varToken);
  if (idx < 0) return null;

  const start = String(html || '').indexOf('[', idx);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '[') {
      depth += 1;
      continue;
    }

    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseNaefListing(raw, fallbackAreaLabel = '') {
  const sourceId = String(raw?.no_dossier || '').trim();
  if (!sourceId) return null;

  const naefTypeCode = String(raw?.type_code || '').trim().toUpperCase();
  // Keep apartments only (Naef feed includes parking/commercial objects too).
  if (naefTypeCode !== 'APP') return null;

  const typeText = `${raw?.type_designation_fr || ''} ${raw?.type_code || ''} ${raw?.intitule_plaquette || ''}`.toLowerCase();
  if (/parking|garage|depot|dépôt|surface|bureau|commerce|arcade|atelier|immeuble|terrain/.test(typeText)) {
    return null;
  }

  const rooms = toPositiveNumber(String(raw?.nb_pieces || '').replace(',', '.'))
    ?? parseRooms(raw?.intitule_plaquette || raw?.type_designation_fr || '');

  const totalChf = toPositiveNumber(raw?.loyer_mensuel_brut) ?? toPositiveNumber(raw?.loyer_mensuel_net);
  const rentChf = toPositiveNumber(raw?.loyer_mensuel_net) ?? totalChf;
  const chargesChf = totalChf != null && rentChf != null ? Math.max(0, totalChf - rentChf) : 0;

  const city = String(raw?.adresse_localite || fallbackAreaLabel || '').trim();
  const postcode = String(raw?.npa || '').trim();
  const address = [raw?.adresse_rue, [postcode, city].filter(Boolean).join(' ')].map((x) => String(x || '').trim()).filter(Boolean).join(', ');

  const url = toAbsoluteUrlForHost(raw?.link || '', 'https://www.naef.ch');
  if (!url || /\/vente\//i.test(url) || /\/location\/(parking|local|commerce|bureau|terrain)\//i.test(url)) return null;

  const imageUrls = [...new Set((Array.isArray(raw?.imgs) ? raw.imgs : [])
    .map((x) => toAbsoluteUrlForHost(x, 'https://www.naef.ch'))
    .filter(Boolean))].slice(0, 6);

  const publishedAtRaw = String(raw?.date_modification || '').trim();
  const publishedAt = publishedAtRaw
    ? new Date(publishedAtRaw.replace(' ', 'T')).toISOString()
    : null;

  return {
    id: `naef:${sourceId}`,
    sourceId,
    url,
    title: stripTags(raw?.intitule_plaquette || raw?.type_designation_fr || 'Appartement'),
    objectType: stripTags(raw?.type_designation_fr || (rooms != null ? `Appartement ${rooms} pièces` : 'Appartement')),
    address,
    area: city,
    rooms,
    surfaceM2: toPositiveNumber(raw?.surface_habitable),
    priceRaw: totalChf != null ? `CHF ${Math.round(totalChf)}/mois` : '',
    rentChf,
    chargesChf,
    totalChf,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    agencyName: 'Naef Immobilier',
    agencyUrl: 'https://www.naef.ch',
    providerName: 'Naef Immobilier',
    source: 'naef.ch',
    listingStage: 'early_market',
    publishedAt: Number.isFinite(new Date(publishedAt).getTime()) ? publishedAt : null
  };
}

async function scrapeNaefListings(config) {
  const out = [];
  const targetAreaSet = buildTargetAreaSet(config?.areas || []);

  try {
    const html = await fetchHtml('https://www.naef.ch/louer/appartements-maisons/');
    const jsonArray = extractJsonArrayVariable(html, 'all_db_datas');
    if (!jsonArray) return out;

    const entries = JSON.parse(jsonArray);
    for (const raw of entries) {
      const parsed = parseNaefListing(raw);
      if (!parsed) continue;
      if (!isTargetAreaCity(parsed.area || '', targetAreaSet)) continue;
      out.push(parsed);
    }
  } catch (err) {
    console.error(`WARN naef source: ${err.message}`);
  }

  return out;
}

function parseHtmlTagAttributes(tag = '') {
  const out = {};
  const regex = /([:@a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(String(tag || '')))) {
    out[match[1]] = decodeHtml(match[2] || '');
  }

  return out;
}

function parseBernardPrice(text = '') {
  const m = String(text || '').match(/CHF\s*([\d'''`\u2018\u2019\s.,]+)/i);
  if (!m) return null;
  // Strip thousands separators (apostrophes) and trailing decimals (.00 / .-)
  const cleaned = String(m[1] || '')
    .replace(/['''`\u2018\u2019\s]/g, '')  // remove thousands separators
    .replace(/\.\-$/, '')                   // trailing .- (e.g. "1700.-")
    .replace(/\.00$/, '');                  // trailing .00 (e.g. "1500.00")
  return toPositiveNumber(Number(cleaned));
}

async function enrichBernardNicodFromDetail(item) {
  if (!item?.url) return;

  try {
    const html = await fetchHtml(item.url);

    // Address: "Vaud, LA TOUR-DE-PEILZ, Chemin des Bulesses 55"
    const addrMatch = html.match(/Adresse\s*:\s*(?:<[^>]*>\s*)*([^<]+)/i);
    if (addrMatch) {
      const raw = addrMatch[1].trim();
      // Format: "Canton, CITY, Street Nr" → keep "Street Nr, NPA City"
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 3) {
        // parts[0]=Canton, parts[1]=CITY, parts[2..]=Street
        const street = parts.slice(2).join(', ');
        const city = parts[1];
        if (street) item.address = `${street}, ${city}`;
        if (city) item.area = city;
      } else if (parts.length === 2) {
        const city = parts[1] || parts[0];
        if (city) item.area = city;
      }
    }

    // Loyer brut (charges included)
    const brutMatch = html.match(/Loyer\s+brut\s*:\s*CHF\s*([\d'''`\u2018\u2019\s.,]+)/i);
    const netMatch = html.match(/Loyer\s+net\s*:\s*CHF\s*([\d'''`\u2018\u2019\s.,]+)/i);
    const acompteMatch = html.match(/Acompte\s*:\s*CHF\s*([\d'''`\u2018\u2019\s.,]+)/i);

    const brut = brutMatch ? parseBernardPrice(`CHF ${brutMatch[1]}`) : null;
    const net = netMatch ? parseBernardPrice(`CHF ${netMatch[1]}`) : null;
    const acompte = acompteMatch ? parseBernardPrice(`CHF ${acompteMatch[1]}`) : null;

    if (brut != null) {
      item.totalChf = brut;
      item.rentChf = net ?? item.rentChf;
      item.chargesChf = acompte ?? (net != null ? Math.round(brut - net) : 0);
      item.priceRaw = `CHF ${Math.round(brut)}/mois`;
    }

    // Rooms from description (e.g. "Appartement de 2 pièces" or "3.5 pièces")
    if (item.rooms == null) {
      const roomsMatch = html.match(/(\d+\.?\d*)\s*pi[eè]ces?/i);
      if (roomsMatch) item.rooms = toPositiveNumber(roomsMatch[1]);
    }

    // Surface from description
    if (item.surfaceM2 == null) {
      const surfMatch = html.match(/Surface\s+habitable\s*:\s*([\d''\s.,]+)\s*m/i);
      if (surfMatch) item.surfaceM2 = toPositiveNumber(chfToNumber(surfMatch[1]));
    }

    // Update derived fields
    if (item.rooms != null) {
      item.objectType = `Appartement ${item.rooms} pièces`;
      item.title = item.title || item.objectType;
    }
  } catch (err) {
    // Detail fetch failed — keep card data
  }
}

function buildBernardSourceId(href = '', title = '') {
  const clean = String(href || '').split('?')[0].replace(/\/$/, '');
  const tail = clean.split('/').filter(Boolean).pop() || '';
  const numeric = tail.match(/-(\d+)$/);
  if (numeric?.[1]) return numeric[1];
  return crypto.createHash('sha1').update(`${clean}|${title}`).digest('hex').slice(0, 16);
}

function parseBernardNicodPropertyCard(rawTag = '', fallbackAreaLabel = '') {
  const attrs = parseHtmlTagAttributes(rawTag);
  const href = String(attrs.href || '').trim();
  if (!href) return null;

  const url = toAbsoluteUrlForHost(href, 'https://www.bernard-nicod.ch');
  if (!url || /\/vente\//i.test(url)) return null;
  if (/\/location\/(parking|local|commerce|bureau|terrain)\//i.test(url)) return null;

  const title = stripTags(attrs.title || slugToTitle(href) || 'Appartement');
  const lower = title.toLowerCase();

  if (/parking|garage|place de parc|villa|maison|chalet|surface|bureau|commerce|arcade|terrain|immeuble/.test(lower)) {
    return null;
  }
  if (!/(appartement|studio|loft|duplex|pi[eè]ces?)/.test(lower)) {
    return null;
  }

  let imageUrls = [];
  try {
    const parsed = JSON.parse(String(attrs[':images'] || '[]'));
    imageUrls = [...new Set((Array.isArray(parsed) ? parsed : [])
      .map((x) => toAbsoluteUrlForHost(x, 'https://www.bernard-nicod.ch'))
      .filter(Boolean))].slice(0, 8);
  } catch {
    imageUrls = [];
  }

  const location = stripTags(attrs.location || fallbackAreaLabel || '');
  const area = location || fallbackAreaLabel || '';
  const surfaceM2 = String(attrs['additional-suffix'] || '').includes('m')
    ? toPositiveNumber(String(attrs.additional || '').replace(',', '.'))
    : null;
  const rooms = parseRooms(title);

  const totalChf = parseBernardPrice(attrs.price || '');
  const sourceId = buildBernardSourceId(href, title);

  return {
    id: `bernard:${sourceId}`,
    sourceId,
    url,
    title,
    objectType: rooms != null ? `Appartement ${rooms} pièces` : 'Appartement',
    address: area,
    area,
    rooms,
    surfaceM2,
    priceRaw: stripTags(attrs.price || ''),
    rentChf: totalChf,
    chargesChf: 0,
    totalChf,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    agencyName: 'Bernard Nicod',
    agencyUrl: 'https://www.bernard-nicod.ch',
    providerName: 'Bernard Nicod',
    source: 'bernard-nicod.ch',
    listingStage: 'early_market',
    publishedAt: null
  };
}

function parseBernardLastPage(html = '') {
  const pages = [...String(html || '').matchAll(/page=(\d+)/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!pages.length) return 1;
  return Math.max(...pages);
}

async function scrapeBernardNicodListings(config) {
  const out = [];
  const targetAreaSet = buildTargetAreaSet(config?.areas || []);
  const maxPages = Math.max(1, Number(config?.bernardNicod?.maxPages ?? 8));

  let lastPage = 1;

  for (let page = 1; page <= Math.min(maxPages, lastPage || maxPages); page += 1) {
    try {
      const url = `https://www.bernard-nicod.ch/search-ajax/buy?action=louer&transaction=buy&page=${page}`;
      const html = await fetchHtml(url);
      if (page === 1) {
        lastPage = Math.max(1, Math.min(maxPages, parseBernardLastPage(html)));
      }

      const cardTags = [...html.matchAll(/<property-card\s+([^>]+)>/gi)].map((m) => m[1]);
      if (!cardTags.length) break;

      for (const rawTag of cardTags) {
        const parsed = parseBernardNicodPropertyCard(rawTag);
        if (!parsed) continue;
        if (!isTargetAreaCity(parsed.area || '', targetAreaSet)) continue;
        out.push(parsed);
      }
    } catch (err) {
      console.error(`WARN bernard-nicod page=${page}: ${err.message}`);
      break;
    }
  }

  // Enrich each listing with detail page data (address, brut price, rooms, surface)
  for (const item of out) {
    await enrichBernardNicodFromDetail(item);
  }

  return out;
}

function parseDrupalSettingsJson(html = '') {
  const match = String(html || '').match(/<script[^>]+data-drupal-selector="drupal-settings-json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseRetraitesMarker(marker = {}) {
  const attrs = marker?.attributes || marker || {};
  const uniqueId = String(attrs?.uniqueID || '').trim();
  if (!uniqueId) return null;

  // Only residential rentals
  if (String(attrs?.offer_type || '').toUpperCase() !== 'RENT') return null;

  const city = String(attrs?.city || '').trim();
  const postalCode = String(attrs?.postal_code || '').trim();
  const street = String(attrs?.street || '').trim();
  const address = [street, [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const rooms = toPositiveNumber(String(attrs?.rooms_number || '').replace(',', '.'));
  const surfaceM2 = toPositiveNumber(attrs?.surface);

  const rentChf = toPositiveNumber(attrs?.price);
  const chargesChf = toPositiveNumber(attrs?.price_extra) ?? 0;
  const totalChf = rentChf != null ? rentChf + (chargesChf || 0) : null;

  // Images: prefer medium > large > originals (medium loads fastest)
  const pictureSizes = Array.isArray(attrs?.pictures?.sizes) ? attrs.pictures.sizes : [];
  const medium = pictureSizes.flatMap((s) => Array.isArray(s?.m) ? s.m : []);
  const large = pictureSizes.flatMap((s) => Array.isArray(s?.l) ? s.l : []);
  const originals = Array.isArray(attrs?.pictures?.originals) ? attrs.pictures.originals : [];

  const imageUrls = [...new Set([...medium, ...large, ...originals]
    .map((x) => toAbsoluteUrlForHost(x, 'https://immobilier2.retraitespopulaires.ch'))
    .filter(Boolean))].slice(0, 8);

  const publishedAtRaw = String(attrs?.publication_date || '').trim();
  const publishedAt = publishedAtRaw ? new Date(`${publishedAtRaw}T00:00:00+01:00`).toISOString() : null;

  const availableDateRaw = String(attrs?.available_date || '').trim();
  const linkRaw = String(attrs?.link || '').trim();

  return {
    id: `rp:${uniqueId}`,
    sourceId: uniqueId,
    url: toAbsoluteUrlForHost(linkRaw, 'https://www.retraitespopulaires.ch'),
    title: rooms != null ? `Appartement ${rooms} pièces` : 'Appartement',
    objectType: rooms != null ? `Appartement ${rooms} pièces` : 'Appartement',
    address,
    area: city,
    rooms,
    surfaceM2,
    priceRaw: totalChf != null ? `CHF ${Math.round(totalChf)}/mois` : '',
    rentChf,
    chargesChf,
    totalChf,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    imageUrlsRemote: imageUrls,
    imageUrlsLocal: [],
    agencyName: stripTags(attrs?.agency_name || 'Retraites Populaires'),
    agencyUrl: 'https://www.retraitespopulaires.ch',
    providerName: stripTags(attrs?.agency_name || 'Retraites Populaires'),
    source: 'retraitespopulaires.ch',
    listingStage: 'early_market',
    movingDateRaw: availableDateRaw || null,
    publishedAt: Number.isFinite(new Date(publishedAt).getTime()) ? publishedAt : null
  };
}

async function scrapeRetraitesPopulairesListings(config) {
  const dedup = new Map();

  const areas = Array.isArray(config?.areas) ? config.areas : [];
  const targetAreaSet = buildTargetAreaSet(areas);
  const rangeKm = Math.max(5, Math.min(30, Number(config?.retraitesListings?.rangeKm ?? 15)));

  // One request per area - markers contain ALL results in range (no pagination needed)
  for (const area of areas) {
    const areaLabel = String(area?.label || '').trim();
    if (!areaLabel) continue;

    const params = new URLSearchParams({
      place: areaLabel,
      range: String(rangeKm),
      type: '0',
      sort_by: 'proximity_asc',
      page: '0'
    });

    const url = `https://www.retraitespopulaires.ch/immobilier/louer/louer-un-appartement?${params.toString()}`;

    try {
      const html = await fetchHtml(url);
      const settings = parseDrupalSettingsJson(html);
      const markers = Array.isArray(settings?.markers) ? settings.markers : [];

      for (const marker of markers) {
        const parsed = parseRetraitesMarker(marker);
        if (!parsed) continue;
        if (!isTargetAreaCity(parsed.area || '', targetAreaSet)) continue;

        const key = String(parsed.id);
        if (!dedup.has(key) || listingQualityRank(parsed, new Map()) > listingQualityRank(dedup.get(key), new Map())) {
          dedup.set(key, parsed);
        }
      }
    } catch (err) {
      console.error(`WARN retraites-populaires listings area="${areaLabel}": ${err.message}`);
    }
  }

  return [...dedup.values()];
}

function guessProjectAreaFromHref(href = '') {
  const clean = String(href || '').split('?')[0].replace(/\/$/, '');
  const last = clean.split('/').filter(Boolean).pop() || '';
  if (!last) return '';

  const words = last
    .split('-')
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^\d+$/.test(x))
    .filter((x) => !['rue', 'route', 'avenue', 'av', 'chemin', 'de', 'du', 'des', 'la', 'le', 'les'].includes(x.toLowerCase()));

  if (!words.length) return '';
  return words.slice(-3).join(' ');
}

function parseRetraitesProjectTeaser(html = '', href = '') {
  const clean = stripTags(String(html || '')).replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (/tout est lou[ée]?/i.test(clean)) return null;

  const extractedLocation = clean.match(/(?:Logement|Mixte)\s+(.+?)\s+Promotions/i)?.[1]?.trim();
  const fallbackTitle = guessProjectAreaFromHref(href)
    .split(' ')
    .map((x) => x ? x[0].toUpperCase() + x.slice(1) : x)
    .join(' ')
    .trim();
  const title = extractedLocation || fallbackTitle || clean;

  const description = clean;
  const commaArea = String(title.split(',').slice(-1)[0] || '').trim();
  const area = commaArea || guessProjectAreaFromHref(href);
  const sourceId = crypto.createHash('sha1').update(String(href || title)).digest('hex').slice(0, 20);

  return {
    id: `rp-project:${sourceId}`,
    sourceId,
    url: toAbsoluteUrlForHost(href, 'https://www.retraitespopulaires.ch'),
    title,
    objectType: 'Projet locatif (pré-commercialisation)',
    address: title,
    area,
    rooms: null,
    surfaceM2: null,
    priceRaw: '',
    rentChf: null,
    chargesChf: 0,
    totalChf: null,
    imageUrl: null,
    imageUrls: [],
    agencyName: 'Retraites Populaires',
    agencyUrl: 'https://www.retraitespopulaires.ch',
    providerName: 'Retraites Populaires',
    source: 'retraitespopulaires.ch',
    listingStage: 'off_market',
    projectDescription: description,
    publishedAt: null
  };
}

function matchesProjectToTargetAreas(project = {}, targetAreaSet) {
  if (!targetAreaSet || !targetAreaSet.size) return true;

  const haystack = normalizeKeyText([
    project?.title,
    project?.address,
    project?.area,
    project?.projectDescription,
    project?.url
  ].filter(Boolean).join(' '));

  for (const areaToken of targetAreaSet) {
    const key = normalizeKeyText(areaToken);
    if (key && haystack.includes(key)) return true;
  }

  return false;
}

async function scrapeRetraitesPopulairesProjects(config) {
  const out = [];
  const seen = new Set();
  const targetAreaSet = buildTargetAreaSet(config?.areas || []);

  try {
    const html = await fetchHtml('https://www.retraitespopulaires.ch/location/parc-immobilier-et-projets-neufs');
    const matches = [...html.matchAll(/<a[^>]+href="([^"]*\/location\/parc-immobilier-et-projets-neuf[^"#?]*)"[^>]*>([\s\S]*?)<\/a>/gi)];

    for (const match of matches) {
      const href = String(match?.[1] || '').trim();
      if (!href || /parc-immobilier-et-projets-neufs\/?$/i.test(href)) continue;

      const teaser = parseRetraitesProjectTeaser(match?.[2] || '', href);
      if (!teaser?.url || seen.has(teaser.url)) continue;
      seen.add(teaser.url);

      if (!matchesProjectToTargetAreas(teaser, targetAreaSet)) continue;

      out.push(teaser);
    }
  } catch (err) {
    console.error(`WARN retraites-populaires projets: ${err.message}`);
  }

  return out;
}

async function fetchFlatfoxListingById(sourceId, fallbackAreaLabel = '') {
  if (!sourceId) return null;

  try {
    const payload = await fetchJson(`https://flatfox.ch/api/v1/public-listing/${encodeURIComponent(sourceId)}/?expand=images`);
    return parseFlatfoxListing(payload, fallbackAreaLabel);
  } catch {
    return null;
  }
}

function buildAddressDedupKey(item) {
  const rawAddress = String(item?.address || '').trim();
  const areaKey = normalizeAreaToken(item?.area || '');

  const normalizedParts = rawAddress
    .split(',')
    .map((part) => normalizeKeyText(part).replace(/\b\d{4}\b/g, ' ').replace(/\bch\b/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (areaKey && !normalizedParts.some((part) => part === areaKey)) {
    normalizedParts.push(areaKey);
  }

  normalizedParts.sort();
  return normalizedParts.join('|');
}

function buildCrossSourceDedupKey(item) {
  const address = buildAddressDedupKey(item);
  if (!address) return null;

  const rooms = Number.isFinite(Number(item?.rooms)) ? String(Math.floor(Number(item.rooms))) : 'na';
  const surface = Number.isFinite(Number(item?.surfaceM2))
    ? String(Math.round(Number(item.surfaceM2) / 5) * 5)
    : 'na';
  const price = Number.isFinite(Number(item?.totalChf)) && Number(item?.totalChf) > 0
    ? String(Math.round(Number(item.totalChf) / 50) * 50)
    : 'na';

  if (rooms === 'na' && surface === 'na' && price === 'na') return null;

  return `${address}|r:${rooms}|s:${surface}|p:${price}`;
}

function listingQualityRank(item, trackerMap) {
  let score = 0;

  if (trackerMap?.has(String(item?.id))) score += 1000;
  score += SOURCE_PRIORITY[item?.source] || 0;
  score += Math.min(Array.isArray(item?.imageUrls) ? item.imageUrls.length : 0, 6);
  if (toPositiveNumber(item?.surfaceM2) != null) score += 2;
  if (toPositiveNumber(item?.totalChf) != null) score += 2;
  if (parseFlatfoxPriceFromText(item?.priceRaw || '') != null) score += 1;

  return score;
}

function dedupeCrossSourceListings(items = [], trackerMap) {
  const byKey = new Map();
  const passthrough = [];

  for (const item of items) {
    const key = buildCrossSourceDedupKey(item);
    if (!key) {
      passthrough.push({ ...item, duplicateSources: [item.source] });
      continue;
    }

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item, duplicateSources: [item.source] });
      continue;
    }

    const keepIncoming = listingQualityRank(item, trackerMap) > listingQualityRank(existing, trackerMap);
    const winner = keepIncoming ? { ...item } : { ...existing };

    const combined = new Set([
      ...(Array.isArray(existing.duplicateSources) ? existing.duplicateSources : [existing.source]),
      item.source,
      winner.source
    ]);

    winner.duplicateSources = [...combined];
    byKey.set(key, winner);
  }

  return [...byKey.values(), ...passthrough];
}

function toMap(list = []) {
  return new Map(list.map((item) => [String(item.id), item]));
}

function makeSummary(latest) {
  const top = latest.matching.slice(0, 5);
  const lines = [];
  lines.push(`Scan terminé: ${latest.totalCount} annonces actives analysées`);
  lines.push(`Nouvelles annonces: ${latest.newCount}`);
  lines.push(`Annonces retirées (conservées en grisé): ${latest.removedCount || 0}`);
  lines.push(`Annonces pertinentes (budget/critères): ${latest.matchingCount}`);
  if (!top.length) {
    lines.push('Aucune nouvelle annonce pertinente au dernier scan.');
  } else {
    lines.push('Top annonces:');
    for (const x of top) {
      const total = x.totalChf != null ? `CHF ${x.totalChf}` : x.priceRaw;
      lines.push(`- [${x.priority}] ${x.objectType} · ${x.area} · ${total} · ${x.url}`);
    }
  }
  return lines.join('\n');
}

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

function defaultAreasForProfile(profile) {
  if (profile === 'fribourg') {
    return [
      { slug: 'chatel-st-denis', label: 'Châtel-Saint-Denis', canton: 'fribourg' },
      { slug: 'romont-fr', label: 'Romont FR', canton: 'fribourg' }
    ];
  }

  if (profile === 'saint-maurice') {
    return [
      { slug: 'st-maurice', label: 'Saint-Maurice', canton: 'valais' }
    ];
  }

  return [
    { slug: 'vevey', label: 'Vevey', canton: 'vaud' },
    { slug: 'tour-peilz', label: 'La Tour-de-Peilz', canton: 'vaud' },
    { slug: 'corseaux', label: 'Corseaux', canton: 'vaud' },
    { slug: 'corsier-vevey', label: 'Corsier-sur-Vevey', canton: 'vaud' }
  ];
}

function makeDefaultConfig(profile, base = null) {
  const isFribourg = profile === 'fribourg';
  const isSaintMaurice = profile === 'saint-maurice';

  const template = base && typeof base === 'object' ? JSON.parse(JSON.stringify(base)) : {
    name: 'Apartment Search',
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
      maxTotalChf: isSaintMaurice ? 1700 : 1400,
      maxTotalHardChf: isSaintMaurice ? 1700 : (isFribourg ? 1650 : 1550),
      maxPearlTotalChf: isSaintMaurice ? 1700 : (isFribourg ? 1750 : 1650),
      maxPublishedAgeDays: (isFribourg || isSaintMaurice) ? 20 : null,
      minRoomsPreferred: isSaintMaurice ? 3 : (isFribourg ? 2.5 : 2),
      minSurfaceM2Preferred: isFribourg ? 50 : 0,
      allowStudioTransition: (isFribourg || isSaintMaurice) ? false : true,
      excludedObjectTypeKeywords: ['chambre', 'colocation', 'wg'],
      missingScansBeforeRemoved: 2,
      moveInDeadline: '2026-03-01'
    },
    preferences: {
      natureViewPreferred: true,
      washingMachinePreferred: true,
      bathtubPreferred: true,
      workplaceAddress: isSaintMaurice
        ? 'Gare de Saint-Maurice, 1890 Saint-Maurice, Suisse'
        : DEFAULT_WORK_ADDRESS
    }
  };

  const titleSuffix = isFribourg ? 'Fribourg' : (isSaintMaurice ? 'Saint-Maurice' : 'Vevey');
  template.name = `Apartment Search (${titleSuffix})`;
  template.areas = defaultAreasForProfile(profile);
  template.sources = {
    ...(template.sources || {}),
    immobilier: template.sources?.immobilier !== false,
    flatfox: template.sources?.flatfox !== false,
    naef: template.sources?.naef !== false,
    bernardNicod: template.sources?.bernardNicod !== false,
    retraitesListings: template.sources?.retraitesListings !== false,
    retraitesProjets: template.sources?.retraitesProjets !== false,
    anibis: !!template.sources?.anibis
  };
  template.flatfox = {
    maxPagesPerArea: 3,
    recheckKnownIdsLimit: 20,
    ...(template.flatfox || {})
  };

  template.filters = {
    ...(template.filters || {}),
    maxTotalChf: Number(template.filters?.maxTotalChf ?? (isSaintMaurice ? 1700 : 1400)),
    maxTotalHardChf: Number(template.filters?.maxTotalHardChf ?? (isSaintMaurice ? 1700 : (isFribourg ? 1650 : 1550))),
    maxPearlTotalChf: Number(template.filters?.maxPearlTotalChf ?? (isSaintMaurice ? 1700 : (isFribourg ? 1750 : 1650))),
    minRoomsPreferred: Number(template.filters?.minRoomsPreferred ?? (isSaintMaurice ? 3 : (isFribourg ? 2.5 : 2))),
    maxPublishedAgeDays: (isFribourg || isSaintMaurice)
      ? Number(template.filters?.maxPublishedAgeDays ?? 20)
      : (template.filters?.maxPublishedAgeDays ?? null)
  };

  if (isSaintMaurice) {
    template.filters = {
      ...(template.filters || {}),
      maxTotalChf: Number(template.filters?.maxTotalChf ?? 1700),
      maxTotalHardChf: Number(template.filters?.maxTotalHardChf ?? 1700),
      maxPearlTotalChf: Number(template.filters?.maxPearlTotalChf ?? 1700),
      minRoomsPreferred: Number(template.filters?.minRoomsPreferred ?? 3),
      allowStudioTransition: template.filters?.allowStudioTransition === undefined
        ? false
        : !!template.filters?.allowStudioTransition,
      maxPublishedAgeDays: template.filters?.maxPublishedAgeDays == null
        ? 20
        : Number(template.filters?.maxPublishedAgeDays)
    };

    template.preferences = {
      ...(template.preferences || {}),
      workplaceAddress: template.preferences?.workplaceAddress || 'Gare de Saint-Maurice, 1890 Saint-Maurice, Suisse'
    };
    delete template.preferences.transportToLausanne;
  }

  return template;
}

async function bootstrapProfileData(profile) {
  await fs.mkdir(PROFILES_DATA_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });

  const legacyFiles = {
    configPath: path.join(LEGACY_DATA_DIR, 'watch-config.json'),
    trackerPath: path.join(LEGACY_DATA_DIR, 'tracker.json'),
    latestPath: path.join(LEGACY_DATA_DIR, 'latest-listings.json'),
    geocodeCachePath: path.join(LEGACY_DATA_DIR, 'geocode-cache.json'),
    routeCachePath: path.join(LEGACY_DATA_DIR, 'route-cache.json')
  };

  if (profile === 'vevey') {
    for (const [key, legacyPath] of Object.entries(legacyFiles)) {
      const targetPath = {
        configPath: CONFIG_PATH,
        trackerPath: TRACKER_PATH,
        latestPath: LATEST_PATH,
        geocodeCachePath: GEOCODE_CACHE_PATH,
        routeCachePath: ROUTE_CACHE_PATH
      }[key];

      if (!targetPath) continue;
      if (!(await fileExists(targetPath)) && (await fileExists(legacyPath))) {
        await fs.copyFile(legacyPath, targetPath);
      }
    }
  }

  if (!(await fileExists(CONFIG_PATH))) {
    const veveyConfig = await readJsonSafe(path.join(PROFILES_DATA_DIR, 'vevey', 'watch-config.json'), null);
    const legacyConfig = await readJsonSafe(legacyFiles.configPath, null);
    const baseConfig = veveyConfig || legacyConfig || null;
    const config = makeDefaultConfig(profile, baseConfig);
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  }
}

async function main() {
  await bootstrapProfileData(PROFILE);

  const config = await readJsonSafe(CONFIG_PATH, null);
  if (!config) {
    throw new Error(`Config manquante: ${CONFIG_PATH}`);
  }

  if (PROFILE === 'fribourg' || PROFILE === 'saint-maurice') {
    config.sources = {
      ...(config.sources || {})
    };
    if (typeof config.sources.immobilier !== 'boolean') config.sources.immobilier = true;
    if (typeof config.sources.flatfox !== 'boolean') config.sources.flatfox = true;
    if (typeof config.sources.naef !== 'boolean') config.sources.naef = true;
    if (typeof config.sources.bernardNicod !== 'boolean') config.sources.bernardNicod = true;
    if (typeof config.sources.retraitesListings !== 'boolean') config.sources.retraitesListings = true;
    if (typeof config.sources.retraitesProjets !== 'boolean') config.sources.retraitesProjets = true;
    if (typeof config.sources.anibis !== 'boolean') config.sources.anibis = false;
  }

  if (PROFILE === 'saint-maurice') {
    config.filters = {
      ...(config.filters || {}),
      maxTotalChf: Number(config.filters?.maxTotalChf ?? 1700),
      maxTotalHardChf: Number(config.filters?.maxTotalHardChf ?? 1700),
      maxPearlTotalChf: Number(config.filters?.maxPearlTotalChf ?? 1700),
      minRoomsPreferred: Number(config.filters?.minRoomsPreferred ?? 3),
      allowStudioTransition: config.filters?.allowStudioTransition === undefined
        ? false
        : !!config.filters?.allowStudioTransition,
      maxPublishedAgeDays: config.filters?.maxPublishedAgeDays == null
        ? 20
        : Number(config.filters?.maxPublishedAgeDays)
    };

    const existingWorkAddress = config.preferences?.workplaceAddress || config.preferences?.workAddress;
    config.preferences = {
      ...(config.preferences || {})
    };
    if (!existingWorkAddress) {
      config.preferences.workplaceAddress = 'Gare de Saint-Maurice, 1890 Saint-Maurice, Suisse';
    }
    delete config.preferences.transportToLausanne;
  }

  const missingScansBeforeRemoved = Math.max(1, Number(config.filters?.missingScansBeforeRemoved ?? 2));

  const workAddress =
    config.preferences?.workplaceAddress ||
    config.preferences?.workAddress ||
    DEFAULT_WORK_ADDRESS;

  const geocodeCache = await readJsonSafe(GEOCODE_CACHE_PATH, {});
  const routeCache = await readJsonSafe(ROUTE_CACHE_PATH, {});
  const workCoords = await geocodeAddress(workAddress, geocodeCache);

  const previousLatest = await readJsonSafe(LATEST_PATH, { all: [] });
  const prevIds = new Set((previousLatest.all || []).map((x) => String(x.id)));

  const tracker = await readJsonSafe(TRACKER_PATH, {
    createdAt: new Date().toISOString(),
    statuses: STATUSES,
    listings: []
  });

  const trackerMap = toMap(tracker.listings || []);
  const targetAreaSet = buildTargetAreaSet(config.areas || []);

  const scraped = [];

  for (const area of config.areas || []) {
    const canton = resolveImmobilierCanton(area, config);
    const areaLabel = String(area?.label || '').trim();
    const configuredSlug = normalizeSlugCandidate(area?.slug || '');
    const immobilierSlug = await resolveImmobilierSlugForArea(area, config);

    if (immobilierSlug && configuredSlug && immobilierSlug !== configuredSlug) {
      console.log(`INFO immobilier slug auto-resolved for "${areaLabel}": ${configuredSlug} -> ${immobilierSlug}`);
    }

    for (let page = 1; page <= (config.pagesPerArea || 1); page++) {
      const url = `https://www.immobilier.ch/fr/louer/appartement/${canton}/${immobilierSlug || configuredSlug}/page-${page}`;
      try {
        const html = await fetchHtml(url);
        const items = parseListingsFromHtml(html, areaLabel);

        // debug disabled
        for (const item of items) {
          if (!isTargetAreaCity(item.area || '', targetAreaSet)) continue;
          scraped.push(item);
        }
      } catch (err) {
        console.error(`WARN ${url}: ${err.message}`);
      }
    }
  }

  if (config.sources?.flatfox !== false) {
    const flatfoxItems = await scrapeFlatfoxListings(config);
    scraped.push(...flatfoxItems);
  }

  if (config.sources?.naef !== false) {
    const naefItems = await scrapeNaefListings(config);
    scraped.push(...naefItems);
  }

  if (config.sources?.bernardNicod !== false) {
    const bernardItems = await scrapeBernardNicodListings(config);
    scraped.push(...bernardItems);
  }

  if (config.sources?.retraitesListings !== false) {
    const rpListings = await scrapeRetraitesPopulairesListings(config);
    scraped.push(...rpListings);
  }

  if (config.sources?.retraitesProjets !== false) {
    const rpProjectItems = await scrapeRetraitesPopulairesProjects(config);
    scraped.push(...rpProjectItems);
  }

  if (config.sources?.anibis !== false) {
    const anibisItems = await scrapeAnibisListings(config);
    scraped.push(...anibisItems);
  }

  const dedupById = new Map();
  for (const item of scraped) {
    const key = String(item.id);
    const existing = dedupById.get(key);
    if (!existing) {
      dedupById.set(key, item);
      continue;
    }

    const incomingRank = listingQualityRank(item, trackerMap);
    const existingRank = listingQualityRank(existing, trackerMap);
    dedupById.set(key, incomingRank > existingRank ? item : existing);
  }

  if (config.sources?.flatfox !== false) {
    const recheckLimit = Math.max(0, Number(config.flatfox?.recheckKnownIdsLimit ?? 20));
    const missingKnownFlatfox = (tracker.listings || [])
      .filter((x) => x?.source === 'flatfox.ch' && x?.sourceId && !dedupById.has(String(x.id)))
      .slice(0, recheckLimit);

    for (const old of missingKnownFlatfox) {
      const recovered = await fetchFlatfoxListingById(old.sourceId, old.area || '');
      if (!recovered) continue;
      if (!isTargetAreaCity(recovered.area || '', targetAreaSet)) continue;

      const key = String(recovered.id);
      const existing = dedupById.get(key);
      if (!existing || listingQualityRank(recovered, trackerMap) > listingQualityRank(existing, trackerMap)) {
        dedupById.set(key, recovered);
      }
    }
  }

  const crossSourceDeduped = dedupeCrossSourceListings([...dedupById.values()], trackerMap);
  const dedup = new Map(crossSourceDeduped.map((item) => [String(item.id), item]));
  const activeDedupKeys = new Set(
    crossSourceDeduped
      .map((item) => buildCrossSourceDedupKey(item))
      .filter(Boolean)
  );

  const now = new Date().toISOString();
  const merged = [];

  for (const item of dedup.values()) {
    item.priority = derivePriority(item, config);
    item.lastSeenAt = now;

    const minBudget = Number(config.filters?.minTotalChf ?? 0);
    const hardBudget = config.filters?.maxTotalHardChf ?? 1450;
    item.excludedType = isExcludedType(item, config);
    item.sizeEligible = isSizeEligible(item, config);
    item.isPearl = isPearl(item, config);
    item.withinHardBudget = item.totalChf != null ? item.totalChf <= hardBudget : false;
    item.aboveMinBudget = minBudget <= 0 || (item.totalChf != null && item.totalChf >= minBudget);

    const publicationMeta = publicationEligibility(item, config);
    item.publishedAgeDays = publicationMeta.ageDays;
    item.maxPublishedAgeDays = publicationMeta.maxAgeDays;
    item.publicationEligible = publicationMeta.eligible;

    const locationMeta = locationEligibility(item, config);
    item.locationEligible = locationMeta.eligible;
    item.locationFilterReason = locationMeta.reason;

    const nonSpecMeta = nonSpeculativeEligibility(item, config);
    item.nonSpeculativeEligible = nonSpecMeta.eligible;
    item.nonSpeculativeFilterReason = nonSpecMeta.reason;

    const isOffMarketListing = String(item.listingStage || '').toLowerCase() === 'off_market';

    item.display = isOffMarketListing
      ? (!item.excludedType && item.locationEligible && item.nonSpeculativeEligible)
      : (!item.excludedType
        && item.sizeEligible
        && item.aboveMinBudget
        && (item.withinHardBudget || item.isPearl)
        && item.publicationEligible
        && item.locationEligible
        && item.nonSpeculativeEligible);

    if (item.isPearl && !item.withinHardBudget) {
      item.priority = 'A★';
    }

    if (item.display) {
      if (item.source === 'immobilier.ch') {
        const moveIn = await fetchMoveInDate(item.sourceId || item.id);
        item.entryDateText = moveIn.date;
        item.entryDateFetched = moveIn.fetched;
      } else {
        const moveInDate = parseFlatfoxMoveInDate(item.movingDateRaw);
        item.entryDateText = isStrictEntryDate(moveInDate) ? moveInDate : null;
        item.entryDateFetched = Boolean(item.entryDateText);
      }

      const distanceMeta = await computeDistanceFromWork(item, workCoords, geocodeCache);
      item.distanceKm = distanceMeta.distanceKm;
      item.distanceText = distanceMeta.distanceText;
      item.distanceComputed = distanceMeta.computed;
      item.distanceFromWorkAddress = workAddress;

      const driveMinutes = await fetchDrivingMinutes(workCoords, distanceMeta.listingCoords, routeCache);
      const transitMinutes = await fetchTransitMinutes(workAddress, distanceMeta.listingAddress, routeCache);

      item.driveMinutes = toDurationMinutesOrNull(driveMinutes);
      item.driveText = item.driveMinutes != null ? `${Math.round(item.driveMinutes)} min` : '';
      item.transitMinutes = toDurationMinutesOrNull(transitMinutes);
      item.transitText = item.transitMinutes != null ? `${Math.round(item.transitMinutes)} min` : '';
    } else {
      item.entryDateText = null;
      item.entryDateFetched = false;
      item.distanceKm = null;
      item.distanceText = '';
      item.distanceComputed = false;
      item.distanceFromWorkAddress = workAddress;
      item.driveMinutes = null;
      item.driveText = '';
      item.transitMinutes = null;
      item.transitText = '';
    }

    if (!item.display) {
      if (item.excludedType) item.filterReason = 'Type exclu (chambre/colocation)';
      else if (!item.locationEligible) item.filterReason = item.locationFilterReason || 'Hors zones ciblées';
      else if (!item.nonSpeculativeEligible) item.filterReason = item.nonSpeculativeFilterReason || 'Bailleur hors liste non spéculative';
      else if (isOffMarketListing) item.filterReason = 'Signal off-market non prioritaire';
      else if (!item.aboveMinBudget) item.filterReason = `En dessous de CHF ${minBudget}`;
      else if (!item.sizeEligible) item.filterReason = 'Taille non prioritaire';
      else if (!item.publicationEligible) {
        item.filterReason = `Annonce trop ancienne (> ${item.maxPublishedAgeDays} jours)`;
      } else item.filterReason = `Au-dessus de CHF ${hardBudget}`;
    } else {
      item.filterReason = '';
    }

    const existing = trackerMap.get(String(item.id));
    if (existing) {
      const previousValidDate = isStrictEntryDate(existing.entryDateText) ? existing.entryDateText : null;
      const apiProvidedDate = isStrictEntryDate(item.entryDateText) ? item.entryDateText : null;
      const entryDateText = item.entryDateFetched ? apiProvidedDate : previousValidDate;

      const distanceKm = item.distanceComputed ? item.distanceKm : existing.distanceKm ?? null;
      const distanceText = item.distanceComputed
        ? item.distanceText || ''
        : existing.distanceText || (existing.distanceKm != null ? `${Number(existing.distanceKm).toFixed(1)} km` : '');

      const driveMinutes = toDurationMinutesOrNull(item.driveMinutes)
        ?? toDurationMinutesOrNull(existing.driveMinutes);
      const driveText = driveMinutes != null
        ? `${Math.round(driveMinutes)} min`
        : sanitizeTravelText(existing.driveText || '');

      const transitMinutes = toDurationMinutesOrNull(item.transitMinutes)
        ?? toDurationMinutesOrNull(existing.transitMinutes);
      const transitText = transitMinutes != null
        ? `${Math.round(transitMinutes)} min`
        : sanitizeTravelText(existing.transitText || '');

      merged.push({
        ...existing,
        ...item,
        pinned: !!existing.pinned,
        entryDateText,
        distanceKm,
        distanceText,
        driveMinutes,
        driveText,
        transitMinutes,
        transitText,
        publishedAt: item.publishedAt || existing.publishedAt || null,
        status: normalizeStatus(existing.status || 'À contacter'),
        notes: mergeNotesWithEntryDate(existing.notes || '', entryDateText),
        firstSeenAt: existing.firstSeenAt || now,
        active: true,
        isRemoved: false,
        removedAt: null,
        missingCount: 0,
        isNew: !prevIds.has(String(item.id))
      });
    } else {
      const entryDateText = isStrictEntryDate(item.entryDateText) ? item.entryDateText : null;
      merged.push({
        ...item,
        entryDateText,
        distanceKm: item.distanceComputed ? item.distanceKm : null,
        distanceText: item.distanceComputed ? item.distanceText || '' : '',
        driveMinutes: toDurationMinutesOrNull(item.driveMinutes),
        driveText: toDurationMinutesOrNull(item.driveMinutes) != null ? `${Math.round(toDurationMinutesOrNull(item.driveMinutes))} min` : '',
        transitMinutes: toDurationMinutesOrNull(item.transitMinutes),
        transitText: toDurationMinutesOrNull(item.transitMinutes) != null ? `${Math.round(toDurationMinutesOrNull(item.transitMinutes))} min` : '',
        publishedAt: item.publishedAt || null,
        status: 'À contacter',
        notes: mergeNotesWithEntryDate('', entryDateText),
        firstSeenAt: now,
        active: true,
        isRemoved: false,
        removedAt: null,
        missingCount: 0,
        isNew: true
      });
    }
  }

  for (const old of tracker.listings || []) {
    if (!dedup.has(String(old.id))) {
      const nextMissing = Number(old.missingCount || 0) + 1;

      const outOfScopeListing = !isTargetAreaCity(old.area || '', targetAreaSet);

      if (outOfScopeListing) {
        merged.push({
          ...old,
          status: normalizeStatus(old.status),
          active: false,
          isRemoved: false,
          removedAt: old.removedAt || null,
          missingCount: nextMissing,
          isNew: false,
          display: false,
          filterReason: 'Hors zone suivie'
        });
        continue;
      }

      const sourceLower = String(old?.source || '').toLowerCase();
      const nonResidentialDirectSource = ['naef.ch', 'bernard-nicod.ch'].includes(sourceLower)
        && !isLikelyResidentialListing(old);
      if (nonResidentialDirectSource) {
        merged.push({
          ...old,
          status: normalizeStatus(old.status),
          active: false,
          isRemoved: true,
          removedAt: old.removedAt || now,
          missingCount: nextMissing,
          isNew: false,
          display: false,
          filterReason: 'Objet non résidentiel (filtré)'
        });
        continue;
      }

      const minBudget = Number(config.filters?.minTotalChf ?? 0);
      const hardBudget = config.filters?.maxTotalHardChf ?? 1450;

      const publicationMeta = publicationEligibility(old, config);
      const locationMeta = locationEligibility(old, config);
      const nonSpecMeta = nonSpeculativeEligibility(old, config);

      const refreshed = {
        excludedType: isExcludedType(old, config),
        sizeEligible: isSizeEligible(old, config),
        isPearl: isPearl(old, config),
        withinHardBudget: old.totalChf != null ? old.totalChf <= hardBudget : false,
        aboveMinBudget: minBudget <= 0 || (old.totalChf != null && old.totalChf >= minBudget),
        publishedAgeDays: publicationMeta.ageDays,
        maxPublishedAgeDays: publicationMeta.maxAgeDays,
        publicationEligible: publicationMeta.eligible,
        locationEligible: locationMeta.eligible,
        locationFilterReason: locationMeta.reason,
        nonSpeculativeEligible: nonSpecMeta.eligible,
        nonSpeculativeFilterReason: nonSpecMeta.reason
      };

      const isOffMarketListing = String(old.listingStage || '').toLowerCase() === 'off_market';

      refreshed.display = isOffMarketListing
        ? (!refreshed.excludedType && refreshed.locationEligible && refreshed.nonSpeculativeEligible)
        : (!refreshed.excludedType
          && refreshed.sizeEligible
          && refreshed.aboveMinBudget
          && (refreshed.withinHardBudget || refreshed.isPearl)
          && refreshed.publicationEligible
          && refreshed.locationEligible
          && refreshed.nonSpeculativeEligible);

      refreshed.priority = refreshed.isPearl && !refreshed.withinHardBudget ? 'A★' : derivePriority(old, config);

      if (!refreshed.display) {
        if (refreshed.excludedType) refreshed.filterReason = 'Type exclu (chambre/colocation)';
        else if (!refreshed.locationEligible) refreshed.filterReason = refreshed.locationFilterReason || 'Hors zones ciblées';
        else if (!refreshed.nonSpeculativeEligible) refreshed.filterReason = refreshed.nonSpeculativeFilterReason || 'Bailleur hors liste non spéculative';
        else if (isOffMarketListing) refreshed.filterReason = 'Signal off-market non prioritaire';
        else if (!refreshed.aboveMinBudget) refreshed.filterReason = `En dessous de CHF ${minBudget}`;
        else if (!refreshed.sizeEligible) refreshed.filterReason = 'Taille non prioritaire';
        else if (!refreshed.publicationEligible) {
          refreshed.filterReason = `Annonce trop ancienne (> ${refreshed.maxPublishedAgeDays} jours)`;
        } else refreshed.filterReason = `Au-dessus de CHF ${hardBudget}`;
      } else {
        refreshed.filterReason = '';
      }

      const oldDedupKey = buildCrossSourceDedupKey(old);
      const duplicateOfActive = refreshed.display !== false && oldDedupKey && activeDedupKeys.has(oldDedupKey);
      const excludedAnibisSale = isStoredAnibisSaleListing(old);
      const anibisSourceDisabled = String(old?.source || '') === 'anibis.ch' && config.sources?.anibis === false;
      const shouldRemove = duplicateOfActive || excludedAnibisSale || anibisSourceDisabled
        ? true
        : (refreshed.display === false ? false : nextMissing >= missingScansBeforeRemoved);

      if (duplicateOfActive || excludedAnibisSale || anibisSourceDisabled) {
        merged.push({
          ...old,
          status: normalizeStatus(old.status),
          active: false,
          isRemoved: true,
          removedAt: old.removedAt || now,
          missingCount: nextMissing,
          isNew: false,
          display: false,
          filterReason: duplicateOfActive
            ? 'Doublon inter-source'
            : (excludedAnibisSale ? 'Annonce vente exclue (Anibis)' : 'Source Anibis désactivée')
        });
        continue;
      }

      let distanceKm = toNumberOrNull(old.distanceKm);
      let distanceText = old.distanceText || (distanceKm != null ? `${distanceKm.toFixed(1)} km` : '');
      let driveMinutes = toDurationMinutesOrNull(old.driveMinutes);
      let transitMinutes = toDurationMinutesOrNull(old.transitMinutes);

      if (refreshed.display !== false && (!shouldRemove || driveMinutes == null || transitMinutes == null || distanceKm == null)) {
        const distanceMeta = await computeDistanceFromWork(old, workCoords, geocodeCache);

        if (distanceMeta.computed) {
          distanceKm = distanceMeta.distanceKm;
          distanceText = distanceMeta.distanceText;

          if (driveMinutes == null) {
            driveMinutes = toDurationMinutesOrNull(await fetchDrivingMinutes(workCoords, distanceMeta.listingCoords, routeCache));
          }

          if (transitMinutes == null) {
            transitMinutes = toDurationMinutesOrNull(await fetchTransitMinutes(workAddress, distanceMeta.listingAddress, routeCache));
          }
        }
      }

      merged.push({
        ...old,
        ...refreshed,
        distanceKm,
        distanceText,
        driveMinutes,
        driveText: driveMinutes != null ? `${Math.round(driveMinutes)} min` : sanitizeTravelText(old.driveText || ''),
        transitMinutes,
        transitText: transitMinutes != null ? `${Math.round(transitMinutes)} min` : sanitizeTravelText(old.transitText || ''),
        distanceFromWorkAddress: old.distanceFromWorkAddress || workAddress,
        status: normalizeStatus(old.status),
        active: !shouldRemove,
        isRemoved: shouldRemove,
        removedAt: shouldRemove ? old.removedAt || now : null,
        missingCount: nextMissing,
        isNew: false
      });
    }
  }

  for (const item of merged) {
    const scoreMeta = computeScore(item, config);
    item.score = scoreMeta.score;
    item.scoreBreakdown = scoreMeta.reasons;
    item.scoreTooltip = [`Score: ${scoreMeta.score}`, ...scoreMeta.reasons].join(' · ');
  }

  merged.sort((a, b) => {
    const av = a.active ? 1 : 0;
    const bv = b.active ? 1 : 0;
    if (av !== bv) return bv - av;
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (a.totalChf || 999999) - (b.totalChf || 999999);
  });

  normalizeListingImageFields(merged);

  const visibleActive = merged.filter((x) => x.active && x.display !== false);
  const visibleRemoved = merged.filter((x) => !x.active && x.display !== false && x.isRemoved);
  const visibleAll = merged.filter((x) => x.display !== false);

  // Archive images only while flats are still visible/active.
  await localizeVisibleListingImages(visibleActive, config);

  const matching = visibleActive;
  const newListings = matching.filter((x) => x.isNew || !prevIds.has(String(x.id)));

  const latest = {
    generatedAt: now,
    totalCount: visibleActive.length,
    removedCount: visibleRemoved.length,
    matchingCount: matching.length,
    newCount: newListings.length,
    newListings,
    matching,
    all: visibleAll
  };

  const newTracker = {
    ...tracker,
    updatedAt: now,
    criteria: config,
    statuses: STATUSES,
    listings: merged
  };

  await fs.writeFile(TRACKER_PATH, JSON.stringify(newTracker, null, 2));
  await fs.writeFile(LATEST_PATH, JSON.stringify(latest, null, 2));
  await fs.writeFile(GEOCODE_CACHE_PATH, JSON.stringify(geocodeCache, null, 2));
  await fs.writeFile(ROUTE_CACHE_PATH, JSON.stringify(routeCache, null, 2));

  console.log(makeSummary(latest));
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
