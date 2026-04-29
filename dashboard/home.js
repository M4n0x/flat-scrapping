import { formatMarkerDetails, popupHtml } from './map-utils.js';

const gridEl = document.getElementById('profiles-grid');
const createSection = document.getElementById('create-section');
const formEl = document.getElementById('profile-form');
const formTitleEl = document.getElementById('form-title');
const formSubmitEl = document.getElementById('form-submit');
const formCancelEl = document.getElementById('form-cancel');
const editSlugEl = document.getElementById('edit-slug');
const zonesListEl = document.getElementById('zones-list');
const zoneSearchEl = document.getElementById('zone-search');
const zoneSuggestionsEl = document.getElementById('zone-suggestions');
const workplaceEl = document.getElementById('f-workplace');
const workplaceSuggestionsEl = document.getElementById('workplace-suggestions');
const pearlEnabledEl = document.getElementById('f-pearl-enabled');
const pearlOptionsEl = document.getElementById('pearl-options');
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

let zones = [];
let allProfiles = [];
let suggestAbort = null;
let activeIndex = -1;
let mapInstance = null;
let mapLayer = null;
let mapPayload = null;
let mapLoaded = false;
let mapMode = localStorage.getItem(MAP_MODE_STORAGE_KEY) === 'details' ? 'details' : 'points';
let visibleProfileSlugs = new Set();

// --- Canton mapping ---

const CANTON_MAP = {
  ag: 'aargau', ai: 'appenzell-innerrhoden', ar: 'appenzell-ausserrhoden',
  be: 'bern', bl: 'basel-landschaft', bs: 'basel-stadt',
  fr: 'fribourg', ge: 'geneve', gl: 'glarus', gr: 'graubunden',
  ju: 'jura', lu: 'luzern', ne: 'neuchatel', nw: 'nidwalden',
  ow: 'obwalden', sg: 'st-gallen', sh: 'schaffhausen', so: 'solothurn',
  sz: 'schwyz', tg: 'thurgau', ti: 'ticino', ur: 'uri',
  vd: 'vaud', vs: 'valais', zg: 'zug', zh: 'zurich'
};

// --- Autocomplete ---

function buildSlug(label) {
  return label
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseGeoResult(result) {
  const a = result.attrs;
  const rawLabel = (a.label || '').replace(/<[^>]+>/g, '').trim();
  const detail = (a.detail || '').toLowerCase();

  // Extract canton abbreviation from detail (e.g. "vevey vd" -> "vd")
  const cantonMatch = detail.match(/\b([a-z]{2})$/);
  const cantonAbbr = cantonMatch ? cantonMatch[1] : '';
  const canton = CANTON_MAP[cantonAbbr] || cantonAbbr;

  // Extract clean city name (remove canton suffix like "(VD)")
  const cityName = rawLabel.replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();

  return {
    label: cityName,
    slug: buildSlug(cityName),
    canton,
    cantonAbbr: cantonAbbr.toUpperCase(),
    npa: null, // geo.admin.ch gg25 doesn't always return NPA
    lat: a.lat,
    lon: a.lon
  };
}

// --- Generic geo.admin.ch autocomplete ---

function createGeoAutocomplete({ inputEl, listEl, origins, renderItem, onSelect, minChars = 2 }) {
  let abort = null;
  let timer = null;
  let results = [];
  let idx = -1;

  async function search(query) {
    if (abort) abort.abort();
    const controller = new AbortController();
    abort = controller;
    const originsParam = origins ? `&origins=${origins}` : '';
    const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(query)}&type=locations${originsParam}&limit=8`;
    try {
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      return (data.results || []).map(parseGeoResult);
    } catch (err) {
      if (err.name === 'AbortError') return [];
      return [];
    }
  }

  function render(items) {
    listEl.innerHTML = '';
    idx = -1;
    results = items;
    if (!items.length) { listEl.classList.add('hidden'); return; }
    for (let i = 0; i < items.length; i++) {
      const li = document.createElement('li');
      li.dataset.index = i;
      li.innerHTML = renderItem(items[i]);
      li.addEventListener('click', () => { onSelect(items[i]); listEl.classList.add('hidden'); });
      li.addEventListener('mouseenter', () => setActive(i));
      listEl.appendChild(li);
    }
    listEl.classList.remove('hidden');
  }

  function setActive(i) {
    const items = listEl.querySelectorAll('li');
    items.forEach((li) => li.classList.remove('active'));
    idx = i;
    if (i >= 0 && i < items.length) { items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' }); }
  }

  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    clearTimeout(timer);
    if (q.length < minChars) { listEl.classList.add('hidden'); return; }
    timer = setTimeout(async () => { render(await search(q)); }, 250);
  });

  inputEl.addEventListener('keydown', (e) => {
    const items = listEl.querySelectorAll('li');
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(idx + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(idx - 1, 0)); }
    else if (e.key === 'Enter' && idx >= 0 && idx < results.length) { e.preventDefault(); onSelect(results[idx]); listEl.classList.add('hidden'); }
    else if (e.key === 'Escape') { listEl.classList.add('hidden'); }
  });
}

// Close all suggestion dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.zone-autocomplete-wrap')) {
    document.querySelectorAll('.zone-suggestions').forEach((el) => el.classList.add('hidden'));
  }
});

// --- Zone autocomplete ---

createGeoAutocomplete({
  inputEl: zoneSearchEl,
  listEl: zoneSuggestionsEl,
  origins: 'gg25',
  renderItem: (r) => `
    <span class="suggestion-label">${escapeHtml(r.label)}</span>
    <span class="suggestion-detail">${escapeHtml(r.cantonAbbr)} · ${escapeHtml(r.canton)}</span>
  `,
  onSelect: (r) => {
    if (zones.some((z) => z.slug === r.slug)) { zoneSearchEl.value = ''; return; }
    zones.push({ slug: r.slug, label: r.label, canton: r.canton, lat: r.lat, lon: r.lon });
    zoneSearchEl.value = '';
    renderZones();
  }
});

// --- Workplace autocomplete ---

createGeoAutocomplete({
  inputEl: workplaceEl,
  listEl: workplaceSuggestionsEl,
  origins: null, // search all (addresses, places, etc.)
  renderItem: (r) => `<span class="suggestion-label">${escapeHtml(r.label)}</span>`,
  onSelect: (r) => { workplaceEl.value = r.label; },
  minChars: 3
});

// Prevent workplace autocomplete from clearing value on select (override default)
workplaceEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    // Don't let generic handler clear the input for workplace
    const list = workplaceSuggestionsEl;
    if (list.classList.contains('hidden')) return; // let form submit
    e.preventDefault();
  }
});

// --- Pearl toggle ---

pearlEnabledEl.addEventListener('change', () => {
  pearlOptionsEl.classList.toggle('hidden', !pearlEnabledEl.checked);
});

// --- Zone rendering ---

function renderZones() {
  zonesListEl.innerHTML = '';
  if (!zones.length) {
    zonesListEl.innerHTML = '<span style="color:var(--muted);font-size:0.82rem">Aucune zone ajoutée — recherchez une commune ci-dessous</span>';
    return;
  }
  for (const z of zones) {
    const chip = document.createElement('span');
    chip.className = 'zone-chip';
    const cantonBadge = z.canton ? ` <small style="opacity:.6">${escapeHtml(z.canton)}</small>` : '';
    chip.innerHTML = `${escapeHtml(z.label)}${cantonBadge}
      <button type="button" class="remove-zone" title="Retirer">&times;</button>`;
    chip.querySelector('.remove-zone').addEventListener('click', () => {
      zones = zones.filter((x) => x.slug !== z.slug);
      renderZones();
    });
    zonesListEl.appendChild(chip);
  }
}

// --- Form logic ---

function showForm(mode = 'create', profile = null) {
  createSection.classList.remove('hidden');

  if (mode === 'edit' && profile) {
    formTitleEl.textContent = `Modifier – ${profile.shortTitle || profile.slug}`;
    formSubmitEl.textContent = 'Enregistrer';
    editSlugEl.value = profile.slug;

    document.getElementById('f-title').value = profile.shortTitle || '';
    zones = [...(profile.areas || [])];
    document.getElementById('f-min-rent').value = profile.filters?.minTotalChf ?? 0;
    document.getElementById('f-max-rent').value = profile.filters?.maxTotalChf ?? 1400;
    document.getElementById('f-hard-max').value = profile.filters?.maxTotalHardChf ?? 1550;
    document.getElementById('f-pearl-max').value = profile.filters?.maxPearlTotalChf ?? 1650;
    document.getElementById('f-min-rooms').value = profile.filters?.minRoomsPreferred ?? 2;
    document.getElementById('f-min-surface').value = profile.filters?.minSurfaceM2Preferred ?? 0;
    document.getElementById('f-max-age').value = profile.filters?.maxPublishedAgeDays ?? 30;
    document.getElementById('f-allow-missing-surface').checked = profile.filters?.allowMissingSurface !== false;
    document.getElementById('f-workplace').value = profile.preferences?.workplaceAddress ?? '';
    document.getElementById('s-immobilier').checked = profile.sources?.immobilier !== false;
    document.getElementById('s-flatfox').checked = profile.sources?.flatfox !== false;
    document.getElementById('s-naef').checked = profile.sources?.naef !== false;
    document.getElementById('s-bernard').checked = profile.sources?.bernardNicod !== false;
    document.getElementById('s-rp-listings').checked = profile.sources?.retraitesListings !== false;
    document.getElementById('s-rp-projects').checked = profile.sources?.retraitesProjets !== false;
    document.getElementById('s-anibis').checked = !!profile.sources?.anibis;
    document.getElementById('f-studio').checked = !!profile.filters?.allowStudioTransition;

    // Pearl config
    const pearl = profile.filters?.pearl || {};
    const pearlEnabled = pearl.enabled !== false;
    pearlEnabledEl.checked = pearlEnabled;
    pearlOptionsEl.classList.toggle('hidden', !pearlEnabled);
    document.getElementById('f-pearl-min-rooms').value = pearl.minRooms ?? 2;
    document.getElementById('f-pearl-min-surface').value = pearl.minSurfaceM2 ?? 50;
    document.getElementById('f-pearl-keywords').value = (pearl.keywords || ['rénové', 'balcon', 'terrasse', 'vue', 'quartier paisible', 'lac', 'centre']).join(', ');
    document.getElementById('f-pearl-min-hits').value = pearl.minHits ?? 1;
  } else {
    formTitleEl.textContent = 'Nouveau profil';
    formSubmitEl.textContent = 'Créer le profil';
    editSlugEl.value = '';
    formEl.reset();
    zones = [];
    document.getElementById('f-allow-missing-surface').checked = true;
    pearlEnabledEl.checked = true;
    pearlOptionsEl.classList.remove('hidden');
  }

  renderZones();
  createSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideForm() {
  createSection.classList.add('hidden');
  editSlugEl.value = '';
  zones = [];
  zoneSearchEl.value = '';
  zoneSuggestionsEl.classList.add('hidden');
}

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

formCancelEl.addEventListener('click', hideForm);

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();

  const isEdit = !!editSlugEl.value;
  const shortTitle = document.getElementById('f-title').value.trim();

  if (!shortTitle) return alert('Titre requis');
  if (!zones.length) return alert('Ajoutez au moins une zone');

  const slug = isEdit
    ? editSlugEl.value
    : shortTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+$/g, '');

  const payload = {
    slug,
    shortTitle,
    areas: zones,
    sources: {
      immobilier: document.getElementById('s-immobilier').checked,
      flatfox: document.getElementById('s-flatfox').checked,
      naef: document.getElementById('s-naef').checked,
      bernardNicod: document.getElementById('s-bernard').checked,
      retraitesListings: document.getElementById('s-rp-listings').checked,
      retraitesProjets: document.getElementById('s-rp-projects').checked,
      anibis: document.getElementById('s-anibis').checked
    },
    filters: {
      minTotalChf: Number(document.getElementById('f-min-rent').value) || 0,
      maxTotalChf: Number(document.getElementById('f-max-rent').value) || 1400,
      maxTotalHardChf: Number(document.getElementById('f-hard-max').value) || 1550,
      maxPearlTotalChf: Number(document.getElementById('f-pearl-max').value) || 1650,
      minRoomsPreferred: Number(document.getElementById('f-min-rooms').value) || 2,
      minSurfaceM2Preferred: Number(document.getElementById('f-min-surface').value) || 0,
      maxPublishedAgeDays: Number(document.getElementById('f-max-age').value) || 30,
      allowMissingSurface: document.getElementById('f-allow-missing-surface').checked,
      allowStudioTransition: document.getElementById('f-studio').checked,
      pearl: {
        enabled: pearlEnabledEl.checked,
        minRooms: Number(document.getElementById('f-pearl-min-rooms').value) || 2,
        minSurfaceM2: Number(document.getElementById('f-pearl-min-surface').value) || 50,
        keywords: document.getElementById('f-pearl-keywords').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
        minHits: Number(document.getElementById('f-pearl-min-hits').value) || 1
      }
    },
    preferences: {
      workplaceAddress: document.getElementById('f-workplace').value.trim() || null
    }
  };

  formSubmitEl.disabled = true;
  formSubmitEl.textContent = '…';

  try {
    const endpoint = isEdit ? '/api/profile/update' : '/api/profile/create';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erreur inconnue');
    hideForm();
    await loadProfiles();
  } catch (err) {
    alert(`Erreur: ${err.message}`);
  } finally {
    formSubmitEl.disabled = false;
    formSubmitEl.textContent = isEdit ? 'Enregistrer' : 'Créer le profil';
  }
});

// --- Profile cards ---

function escapeHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderProfiles(profiles) {
  gridEl.innerHTML = '';
  allProfiles = profiles;

  for (const p of profiles) {
    const card = document.createElement('article');
    card.className = 'profile-card';

    const lastScan = p.lastScanAt
      ? new Date(p.lastScanAt).toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Jamais';

    const profileUrl = `/${encodeURIComponent(p.slug)}/dashboard`;

    card.innerHTML = `
      <a href="${profileUrl}" class="card-link">
        <h3>${escapeHtml(p.shortTitle || p.name)}</h3>
        <div class="card-zones">${escapeHtml(p.areas || 'Aucune zone')}</div>
      </a>
      <div class="card-stats">
        <span>📊 ${p.listingsCount ?? '–'} annonces</span>
        <span>💰 max CHF ${p.maxRent ?? '–'}</span>
        <span>🔄 ${escapeHtml(lastScan)}</span>
      </div>
      <div class="card-actions">
        <a href="${profileUrl}" class="btn primary">Ouvrir</a>
        <button type="button" class="btn edit-btn" data-slug="${escapeHtml(p.slug)}">Modifier</button>
        <button type="button" class="btn danger delete-btn" data-slug="${escapeHtml(p.slug)}" data-name="${escapeHtml(p.label || p.slug)}">Supprimer</button>
      </div>
    `;

    card.querySelector('.edit-btn').addEventListener('click', (e) => { e.preventDefault(); editProfile(p.slug); });
    card.querySelector('.delete-btn').addEventListener('click', (e) => { e.preventDefault(); confirmDelete(e.currentTarget); });

    gridEl.appendChild(card);
  }

  // Add card
  const addCard = document.createElement('article');
  addCard.className = 'profile-card add-card';
  addCard.innerHTML = `<div class="add-icon">+</div><div class="add-label">Créer un profil</div>`;
  addCard.addEventListener('click', () => showForm('create'));
  gridEl.appendChild(addCard);
}

async function editProfile(slug) {
  try {
    const res = await fetch(`/api/profile/detail?profile=${encodeURIComponent(slug)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    showForm('edit', data.profile);
  } catch (err) {
    alert(`Erreur: ${err.message}`);
  }
}

async function confirmDelete(btn) {
  const slug = btn.dataset.slug;
  const name = btn.dataset.name;
  if (!confirm(`Supprimer le profil « ${name} » et toutes ses données ?\n\nCette action est irréversible.`)) return;

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch('/api/profile/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await loadProfiles();
  } catch (err) {
    alert(`Erreur: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Supprimer';
  }
}

// --- Load ---

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    const { profiles } = await res.json();
    renderProfiles(profiles || []);
  } catch {
    gridEl.innerHTML = '<p style="color:var(--danger)">Impossible de charger les profils.</p>';
  }
}

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

function renderMapRetryError(message) {
  mapStatusEl.innerHTML = `${escapeHtml(message)} <button id="map-retry" class="save-inline" type="button">Réessayer</button>`;
  document.getElementById('map-retry')?.addEventListener('click', loadMapData);
}

function ensureMapInstance() {
  if (mapInstance) return true;
  if (!ensureLeaflet()) {
    renderMapRetryError('Impossible de charger la carte. Vérifiez la connexion réseau.');
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
    if (!ensureMapInstance()) return;
    renderMapMarkers(true);
    mapLoaded = true;
  } catch (err) {
    renderMapRetryError(`Erreur carte: ${err.message}`);
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

// --- Scan all ---

const scanAllBtn = document.getElementById('scan-all-btn');
const scanAllProgress = document.getElementById('scan-all-progress');
const STORAGE_KEY = 'flat-scrapping-scan-job';

function renderScanProgress(job, profileNames) {
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const isDone = job.status === 'done';

  let detailsHtml = '';
  const doneSlugs = new Set(job.results.map((r) => r.slug));
  const allSlugs = allProfiles.map((p) => p.slug);
  let foundRunning = false;

  for (const slug of allSlugs) {
    const result = job.results.find((r) => r.slug === slug);
    const name = profileNames[slug] || slug;
    if (result) {
      const cls = result.ok ? 'done' : 'error';
      detailsHtml += `<span class="profile-status ${cls}">${escapeHtml(name)} ${result.ok ? '✓' : '✗'}</span>`;
    } else if (!isDone && !foundRunning) {
      foundRunning = true;
      detailsHtml += `<span class="profile-status running">${escapeHtml(name)} …</span>`;
    } else {
      detailsHtml += `<span class="profile-status">${escapeHtml(name)}</span>`;
    }
  }

  scanAllProgress.innerHTML = `
    <div class="progress-header">
      <span>${isDone ? '✅ Scan terminé' : `⏳ Scan en cours… ${job.done}/${job.total}`}</span>
      <span>${pct}%</span>
    </div>
    <div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
    <div class="progress-details">${detailsHtml}</div>
  `;
}

function pollScanJob(jobId) {
  scanAllProgress.classList.remove('hidden');
  scanAllBtn.disabled = true;
  scanAllBtn.textContent = '⏳ Scan en cours…';

  const profileNames = allProfiles.reduce((m, p) => { m[p.slug] = p.shortTitle || p.slug; return m; }, {});

  const poll = setInterval(async () => {
    try {
      const statusRes = await fetch(`/api/scan-all-status?jobId=${encodeURIComponent(jobId)}`);
      const job = await statusRes.json();
      if (!job.ok) {
        clearInterval(poll);
        localStorage.removeItem(STORAGE_KEY);
        scanAllBtn.disabled = false;
        scanAllBtn.textContent = '🔄 Tout scanner';
        return;
      }
      renderScanProgress(job, profileNames);
      if (job.status === 'done') {
        clearInterval(poll);
        localStorage.removeItem(STORAGE_KEY);
        scanAllBtn.disabled = false;
        scanAllBtn.textContent = '🔄 Tout scanner';
        await loadProfiles();
        if (mapLoaded) await loadMapData();
      }
    } catch {
      clearInterval(poll);
      localStorage.removeItem(STORAGE_KEY);
      scanAllBtn.disabled = false;
      scanAllBtn.textContent = '🔄 Tout scanner';
    }
  }, 2000);
}

scanAllBtn.addEventListener('click', async () => {
  scanAllBtn.disabled = true;
  scanAllBtn.textContent = '⏳ Lancement…';

  try {
    const res = await fetch('/api/run-scan-all', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erreur');

    const { jobId } = data;
    localStorage.setItem(STORAGE_KEY, jobId);
    pollScanJob(jobId);

  } catch (err) {
    alert(`Erreur: ${err.message}`);
    scanAllBtn.disabled = false;
    scanAllBtn.textContent = '🔄 Tout scanner';
  }
});

// Reprendre un scan en cours au chargement
async function resumeScanIfNeeded() {
  const jobId = localStorage.getItem(STORAGE_KEY);
  if (jobId) {
    try {
      const statusRes = await fetch(`/api/scan-all-status?jobId=${encodeURIComponent(jobId)}`);
      const job = await statusRes.json();
      if (job.ok && job.status === 'running') {
        pollScanJob(jobId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

loadProfiles().then(() => {
  const savedHomeView = localStorage.getItem(HOME_VIEW_STORAGE_KEY);
  setHomeView(savedHomeView === 'map' ? 'map' : 'profiles', false);
  resumeScanIfNeeded();
});
