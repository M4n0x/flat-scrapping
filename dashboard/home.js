import { formatMarkerDetails, popupHtml } from './map-utils.js';

const gridEl = document.getElementById('profiles-grid');
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
const profileDialog = document.getElementById('profile-dialog');
const openCreateBtn = document.getElementById('open-create-dialog');

// --- Dialog helpers ---

function openDialog(dialog) {
  if (!dialog) return;
  const prev = document.activeElement;
  if (prev && prev !== document.body) dialog.__prevFocus = prev;
  dialog.classList.add('open');
  const first = dialog.querySelector(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  first?.focus();
}
function closeDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('open');
  const prev = dialog.__prevFocus;
  if (prev && typeof prev.focus === 'function') prev.focus();
  dialog.__prevFocus = null;
}
function setupDialogClose(dialog) {
  if (!dialog) return;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest?.('[data-close-dialog]')) closeDialog(dialog);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !dialog.classList.contains('open')) return;
    const openSuggestions = dialog.querySelector('.zone-suggestions:not(.hidden)');
    if (openSuggestions) return; // let the autocomplete's own handler close suggestions first
    closeDialog(dialog);
  });
}
setupDialogClose(profileDialog);

function openProfileDialog({ mode, profile } = { mode: 'create' }) {
  if (mode === 'edit' && profile) {
    formTitleEl.textContent = `Modifier · ${profile.label || profile.slug}`;
    formSubmitEl.textContent = 'Enregistrer';
    fillFormFromProfile(profile);
  } else {
    formTitleEl.textContent = 'Nouveau profil';
    formSubmitEl.textContent = 'Créer le profil';
    resetForm();
  }
  openDialog(profileDialog);
}

function closeProfileDialog() {
  closeDialog(profileDialog);
}

openCreateBtn?.addEventListener('click', () => openProfileDialog({ mode: 'create' }));

const HOME_VIEW_STORAGE_KEY = 'apartment-home:view';
const MAP_MODE_STORAGE_KEY = 'apartment-map:mode';
const MAP_VISIBLE_PROFILES_KEY = 'apartment-map:visible-profiles';
const MAP_KNOWN_PROFILES_KEY = 'apartment-map:known-profiles';
const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_RETRY_SCRIPT_ID = 'leaflet-retry-script';
const LEAFLET_RETRY_CSS_ID = 'leaflet-retry-css';

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
let leafletAssetPromise = null;
let leafletCssPromise = null;

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

function fillFormFromProfile(profile) {
  editSlugEl.value = profile.slug;
  document.getElementById('f-title').value = profile.shortTitle || profile.label || '';
  zones = [...(profile.areas || [])];
  document.getElementById('f-min-rent').value = profile.filters?.minTotalChf ?? profile.minRent ?? 0;
  document.getElementById('f-max-rent').value = profile.filters?.maxTotalChf ?? profile.maxRent ?? 1400;
  document.getElementById('f-min-rooms').value = profile.filters?.minRoomsPreferred ?? profile.minRooms ?? 2;
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
  renderZones();
}

function resetForm() {
  editSlugEl.value = '';
  formEl.reset();
  zones = [];
  document.getElementById('f-allow-missing-surface').checked = true;
  zoneSearchEl.value = '';
  zoneSuggestionsEl.classList.add('hidden');
  renderZones();
}

function showForm(mode = 'create', profile = null) {
  openProfileDialog({ mode, profile });
}

function hideForm() {
  closeProfileDialog();
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

  homeTabProfilesEl?.setAttribute('aria-selected', String(view === 'profiles'));
  homeTabMapEl?.setAttribute('aria-selected', String(view === 'map'));

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
      minRoomsPreferred: Number(document.getElementById('f-min-rooms').value) || 2,
      minSurfaceM2Preferred: Number(document.getElementById('f-min-surface').value) || 0,
      maxPublishedAgeDays: Number(document.getElementById('f-max-age').value) || 30,
      allowMissingSurface: document.getElementById('f-allow-missing-surface').checked
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
    await refreshMapIfLoaded();
  } catch (err) {
    alert(`Erreur: ${err.message}`);
  } finally {
    formSubmitEl.disabled = false;
    formSubmitEl.textContent = isEdit ? 'Enregistrer' : 'Créer le profil';
  }
});

// --- Helpers ---

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('fr-CH').replace(/ |\s/g, "'");
}
function formatRelative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const hr = ms / 3.6e6;
  if (hr < 1) return `${Math.round(ms / 6e4)} min`;
  if (hr < 24) return `${Math.round(hr)}h`;
  return `${Math.round(hr / 24)}j`;
}
function cssColor(s) {
  return /^#[0-9a-f]{3,8}$|^rgba?\([\d.,\s%]+\)$|^hsla?\([\d.,\s%deg]+\)$|^[a-z]+$/i.test(String(s || '').trim())
    ? String(s).trim()
    : 'var(--muted)';
}

// --- Profile cards ---

function buildProfileCard(profile) {
  const a = document.createElement('a');
  a.className = 'profile-card';
  a.href = `/${encodeURIComponent(profile.slug)}/dashboard`;

  const zonesText = typeof profile.areas === 'string'
    ? profile.areas
    : Array.isArray(profile.areas)
      ? profile.areas.map((z) => (z && z.label) || z).join(' · ')
      : '';

  const lastScan = profile.lastScanAt
    ? `Scan il y a ${escapeHtml(formatRelative(profile.lastScanAt))}`
    : 'Jamais scanné';

  a.innerHTML = `
    <div class="profile-card-head">
      <h3>${escapeHtml(profile.label || profile.shortTitle || profile.slug)}</h3>
      <div class="profile-card-menu">
        <button class="row-actions" type="button" data-edit aria-label="Modifier le profil" title="Modifier"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
        <button class="row-actions danger" type="button" data-delete aria-label="Supprimer le profil" title="Supprimer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg></button>
      </div>
    </div>
    <div class="profile-card-meta"><span>${escapeHtml(zonesText)}</span></div>
    <div class="profile-card-meta">
      <span>CHF ${escapeHtml(formatPrice(profile.minRent ?? profile.filters?.minTotalChf ?? 0))} – ${escapeHtml(formatPrice(profile.maxRent ?? profile.filters?.maxTotalChf ?? 0))}</span>
      <span>·</span>
      <span>${escapeHtml(String(profile.minRooms ?? profile.filters?.minRoomsPreferred ?? '—'))} pièces min</span>
    </div>
    <div class="profile-card-stats">
      <div class="profile-card-stat"><div class="lbl">Total</div><div class="val">${escapeHtml(String(profile.listingsCount ?? 0))}</div></div>
      <div class="profile-card-stat"><div class="lbl">Priorité A</div><div class="val">${escapeHtml(String(profile.priorityACount ?? 0))}</div></div>
      <div class="profile-card-stat"><div class="lbl">Direct</div><div class="val">${escapeHtml(String(profile.directCount ?? 0))}</div></div>
    </div>
    <div class="profile-card-meta"><span>${lastScan}</span></div>
  `;

  a.querySelector('[data-edit]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    editProfile(profile.slug);
  });

  const deleteBtn = a.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.dataset.slug = profile.slug;
    deleteBtn.dataset.name = profile.label || profile.shortTitle || profile.slug;
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      confirmDelete(deleteBtn);
    });
  }
  return a;
}

function renderProfiles(profiles) {
  gridEl.innerHTML = '';
  allProfiles = profiles;

  if (!profiles.length) {
    gridEl.innerHTML = `
      <div class="empty" style="grid-column: 1 / -1;">
        <div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></div>
        <h3>Aucun profil pour le moment</h3>
        <p>Créez un profil pour commencer à suivre les annonces dans vos zones.</p>
        <button class="btn btn-primary" type="button" id="empty-create-btn">Créer un profil</button>
      </div>
    `;
    document.getElementById('empty-create-btn')?.addEventListener('click', () => openProfileDialog({ mode: 'create' }));
    return;
  }

  for (const p of profiles) {
    gridEl.appendChild(buildProfileCard(p));
  }
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
    await refreshMapIfLoaded();
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
  const currentSlugs = profiles.map((p) => p.slug);
  const currentSet = new Set(currentSlugs);
  const saved = localStorage.getItem(MAP_VISIBLE_PROFILES_KEY);
  if (!saved) {
    localStorage.setItem(MAP_KNOWN_PROFILES_KEY, JSON.stringify(currentSlugs));
    return new Set(currentSlugs);
  }

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new Error('Invalid visible profile filters');

    const savedSet = new Set(parsed.filter((slug) => currentSet.has(slug)));
    let knownSlugs = [];
    const savedKnown = localStorage.getItem(MAP_KNOWN_PROFILES_KEY);
    if (savedKnown) {
      const parsedKnown = JSON.parse(savedKnown);
      if (Array.isArray(parsedKnown)) knownSlugs = parsedKnown;
    } else if (mapPayload?.profiles) {
      knownSlugs = mapPayload.profiles.map((p) => p.slug);
    }

    const knownSet = new Set(knownSlugs.length ? knownSlugs : currentSlugs);
    for (const slug of currentSlugs) {
      if (!knownSet.has(slug)) savedSet.add(slug);
    }

    const reconciled = currentSlugs.filter((slug) => savedSet.has(slug));
    localStorage.setItem(MAP_VISIBLE_PROFILES_KEY, JSON.stringify(reconciled));
    localStorage.setItem(MAP_KNOWN_PROFILES_KEY, JSON.stringify(currentSlugs));
    return new Set(reconciled);
  } catch {
    localStorage.setItem(MAP_VISIBLE_PROFILES_KEY, JSON.stringify(currentSlugs));
    localStorage.setItem(MAP_KNOWN_PROFILES_KEY, JSON.stringify(currentSlugs));
    return new Set(currentSlugs);
  }
}

function saveVisibleProfileSlugs() {
  localStorage.setItem(MAP_VISIBLE_PROFILES_KEY, JSON.stringify([...visibleProfileSlugs]));
}

function setMapMode(nextMode) {
  mapMode = nextMode === 'details' ? 'details' : 'points';
  localStorage.setItem(MAP_MODE_STORAGE_KEY, mapMode);
  mapModePointsEl?.classList.toggle('active', mapMode === 'points');
  mapModeDetailsEl?.classList.toggle('active', mapMode === 'details');
  mapModePointsEl?.setAttribute('aria-selected', String(mapMode === 'points'));
  mapModeDetailsEl?.setAttribute('aria-selected', String(mapMode === 'details'));
  renderMapMarkers(false);
}

function ensureLeaflet() {
  return window.L && typeof window.L.map === 'function';
}

function hasLoadedLeafletCss() {
  return [...document.querySelectorAll('link[rel~="stylesheet"]')].some((link) => {
    const href = String(link.href || '').split('?')[0];
    return href === LEAFLET_CSS_URL && Boolean(link.sheet);
  });
}

function loadLeafletCss() {
  if (hasLoadedLeafletCss()) return Promise.resolve();
  if (leafletCssPromise) return leafletCssPromise;

  leafletCssPromise = new Promise((resolve, reject) => {
    document.getElementById(LEAFLET_RETRY_CSS_ID)?.remove();

    const link = document.createElement('link');
    link.id = LEAFLET_RETRY_CSS_ID;
    link.rel = 'stylesheet';
    link.href = `${LEAFLET_CSS_URL}?retry=${Date.now()}`;
    link.crossOrigin = '';
    link.onload = () => {
      leafletCssPromise = null;
      resolve();
    };
    link.onerror = () => {
      leafletCssPromise = null;
      link.remove();
      reject(new Error('Impossible de charger les styles de la carte. Vérifiez la connexion réseau.'));
    };
    document.head.appendChild(link);
  });

  return leafletCssPromise;
}

function loadLeafletScript() {
  if (ensureLeaflet()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    document.getElementById(LEAFLET_RETRY_SCRIPT_ID)?.remove();

    const script = document.createElement('script');
    script.id = LEAFLET_RETRY_SCRIPT_ID;
    script.src = `${LEAFLET_JS_URL}?retry=${Date.now()}`;
    script.crossOrigin = '';
    script.async = true;
    script.onload = () => {
      if (ensureLeaflet()) {
        resolve();
      } else {
        reject(new Error('Leaflet indisponible après le chargement.'));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Impossible de charger Leaflet. Vérifiez la connexion réseau.'));
    };
    document.head.appendChild(script);
  });
}

function loadLeafletAssets() {
  if (ensureLeaflet() && hasLoadedLeafletCss()) return Promise.resolve();
  if (leafletAssetPromise) return leafletAssetPromise;

  leafletAssetPromise = Promise.all([loadLeafletCss(), loadLeafletScript()])
    .then(() => {
      if (!ensureLeaflet()) {
        throw new Error('Leaflet indisponible après le chargement.');
      }
    })
    .finally(() => {
      leafletAssetPromise = null;
    });

  return leafletAssetPromise;
}

function renderMapRetryError(message) {
  mapStatusEl.innerHTML = `${escapeHtml(message)} <button id="map-retry" class="save-inline" type="button">Réessayer</button>`;
  document.getElementById('map-retry')?.addEventListener('click', loadMapData);
}

async function ensureMapInstance() {
  if (mapInstance) return true;
  try {
    await loadLeafletAssets();
  } catch (err) {
    renderMapRetryError(err.message);
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
    const html = `<div class="map-detail-marker" style="background:${cssColor(color)}">${escapeHtml(formatMarkerDetails(item))}</div>`;
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
    html: `<div class="map-dot-marker" style="background:${cssColor(color)}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9]
  });
}

function buildMapFilterRow(slug, label, color, count) {
  const row = document.createElement('label');
  row.className = 'checkbox map-filter-row';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.profileFilter = slug;
  cb.checked = true;

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = cssColor(color);

  const name = document.createElement('span');
  name.className = 'profile-name';
  name.textContent = label;

  const countEl = document.createElement('span');
  countEl.className = 'count';
  countEl.textContent = String(count);

  row.append(cb, swatch, name, countEl);
  return row;
}

function renderMapFilters() {
  if (!mapPayload) return;
  mapProfileFiltersEl.innerHTML = '';

  for (const profile of mapPayload.profiles) {
    const count = `${profile.mappedCount}/${profile.totalActiveDisplayed}`;
    const row = buildMapFilterRow(profile.slug, profile.title, profile.color, count);
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = visibleProfileSlugs.has(profile.slug);

    cb?.addEventListener('change', (event) => {
      if (event.currentTarget.checked) visibleProfileSlugs.add(profile.slug);
      else visibleProfileSlugs.delete(profile.slug);
      saveVisibleProfileSlugs();
      renderMapMarkers(true);
    });

    mapProfileFiltersEl.appendChild(row);
  }
}

function renderMapMarkers(fitBounds = true) {
  if (!mapPayload || !mapInstance) return false;

  mapLayer.clearLayers();
  const visible = mapPayload.listings.filter((item) => visibleProfileSlugs.has(item.profileSlug));
  const bounds = [];

  for (const item of visible) {
    const marker = window.L.marker([item.lat, item.lon], { icon: createMapIcon(item) });
    marker.bindPopup(popupHtml(item), {
      className: 'global-map-popup',
      closeButton: false,
      maxWidth: 380,
      minWidth: 260
    });
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

  return true;
}

function setPopupCarouselIndex(carousel, nextIndex) {
  const slides = [...carousel.querySelectorAll('[data-carousel-slide]')];
  if (!slides.length) return;

  const index = ((nextIndex % slides.length) + slides.length) % slides.length;
  const activeSlide = slides[index];
  const image = carousel.querySelector('[data-carousel-current]');
  const counter = carousel.querySelector('[data-carousel-count]');
  const src = activeSlide.dataset.carouselUrl || '';

  carousel.dataset.carouselIndex = String(index);
  if (image && src) {
    image.src = src;
    image.alt = `Photo ${index + 1}`;
  }
  if (counter) {
    counter.textContent = `${index + 1} / ${slides.length}`;
  }
}

function handleMapCarouselClick(event) {
  const control = event.target.closest('[data-popup-close], [data-carousel-prev], [data-carousel-next]');
  if (!control) return;

  event.preventDefault();
  event.stopPropagation();

  if (control.matches('[data-popup-close]')) {
    mapInstance?.closePopup();
    return;
  }

  const carousel = control.closest('.map-popup-carousel');
  if (!carousel) return;

  const current = Number(carousel.dataset.carouselIndex || 0);
  if (control.matches('[data-carousel-prev]')) {
    setPopupCarouselIndex(carousel, current - 1);
  } else {
    setPopupCarouselIndex(carousel, current + 1);
  }
}

function handleMapPopupKeydown(event) {
  if (event.key === 'Escape') {
    mapInstance?.closePopup();
  }
}

async function loadMapData() {
  if (!mapStatusEl) return;
  mapStatusEl.textContent = 'Chargement de la carte…';
  try {
    const res = await fetch('/api/map-listings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const nextPayload = await res.json();
    visibleProfileSlugs = loadVisibleProfileSlugs(nextPayload.profiles || []);
    mapPayload = nextPayload;
    renderMapFilters();
    if (!(await ensureMapInstance())) return;
    mapLoaded = renderMapMarkers(true);
  } catch (err) {
    renderMapRetryError(`Erreur carte: ${err.message}`);
  }
}

async function refreshMapIfLoaded() {
  if (mapLoaded) await loadMapData();
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
document.getElementById('global-map')?.addEventListener('click', handleMapCarouselClick);
document.addEventListener('keydown', handleMapPopupKeydown);
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
      <span>${isDone ? 'Scan terminé' : `Scan en cours… ${job.done}/${job.total}`}</span>
      <span>${pct}%</span>
    </div>
    <div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
    <div class="progress-details">${detailsHtml}</div>
  `;
}

function pollScanJob(jobId) {
  scanAllProgress.classList.remove('hidden');
  scanAllBtn.disabled = true;
  scanAllBtn.textContent = 'Scan en cours…';

  const profileNames = allProfiles.reduce((m, p) => { m[p.slug] = p.shortTitle || p.slug; return m; }, {});

  const poll = setInterval(async () => {
    try {
      const statusRes = await fetch(`/api/scan-all-status?jobId=${encodeURIComponent(jobId)}`);
      const job = await statusRes.json();
      if (!job.ok) {
        clearInterval(poll);
        localStorage.removeItem(STORAGE_KEY);
        scanAllBtn.disabled = false;
        scanAllBtn.textContent = 'Tout scanner';
        return;
      }
      renderScanProgress(job, profileNames);
      if (job.status === 'done') {
        clearInterval(poll);
        localStorage.removeItem(STORAGE_KEY);
        scanAllBtn.disabled = false;
        scanAllBtn.textContent = 'Tout scanner';
        await loadProfiles();
        if (mapLoaded) await loadMapData();
      }
    } catch {
      clearInterval(poll);
      localStorage.removeItem(STORAGE_KEY);
      scanAllBtn.disabled = false;
      scanAllBtn.textContent = 'Tout scanner';
    }
  }, 2000);
}

scanAllBtn.addEventListener('click', async () => {
  scanAllBtn.disabled = true;
  scanAllBtn.textContent = 'Lancement…';

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
    scanAllBtn.textContent = 'Tout scanner';
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
