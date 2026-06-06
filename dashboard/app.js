import {
  initMap, setListings, addListing, focusListing, setProfileVisibility,
  onListingClick, onListingHover, getListing, setSelectedMarker,
  setEditMode, addEditZone, removeEditZone, setEditColor,
  onMapBackgroundClick, startLasso, cancelLasso, setLassoStateChangeHandler,
  fitMapToPoints, getPinMode, setPinMode
} from '/dashboard/map.js';
import { applyFilters, defaultFilterState } from '/dashboard/filter-logic.js';
import { renderProfilesPanel, renderQuickSorts, setPanelsVisible } from '/dashboard/filter-panels.js';
import {
  renderListings, highlightRow, markRowAsRead, queueViewed, setHoveredRow,
  setListingsVisible
} from '/dashboard/listings-panel.js';
import { startScan, isScanActive } from '/dashboard/scan.js';
import { initDetailPanel, openDetailPanel, closeDetailPanel, isDetailFor } from '/dashboard/listing-detail.js';
import {
  initProfileEdit, enterEditMode, exitEditMode, isEditing, getEditingSlug,
  setLassoActive, applyDrawnZones
} from '/dashboard/profile-edit.js';

const STATE_KEY = 'apartment-ops:filter-state:v1';

const state = {
  filter: hydrateFilterState(),
  payload: { profiles: [], listings: [] }
};

async function bootstrap() {
  initMap(document.getElementById('map'));

  initDetailPanel({ onAction: handleListingAction });
  initProfileEdit({
    map: {
      onEditStart: handleEditStart,
      onEditEnd: handleEditEnd,
      onZoneAdded: handleZoneAdded,
      onZoneRemoved: handleZoneRemoved,
      onZonesAdded: handleZonesAdded,
      onColorChange: setEditColor,
      onLassoStart: () => startLasso(),
      onLassoCancel: () => cancelLasso()
    },
    onStarted: () => rerender(),
    onSaved: handleProfileSaved,
    onClosed: handleEditClosed
  });

  setLassoStateChangeHandler((active) => setLassoActive(active));

  bindPinModeToggle();

  onListingClick(handlePinClick);
  onListingHover(handlePinHover);
  onMapBackgroundClick(() => {
    if (!isEditing()) closeDetailPanel();
  });

  document.getElementById('listings-clear')?.addEventListener('click', clearVisibleListings);

  document.getElementById('scan-button').addEventListener('click', () => {
    if (isScanActive()) return;
    const visible = state.payload.profiles.filter((p) => !state.filter.hiddenProfiles.has(p.slug));
    if (visible.length === 0) {
      alert('Aucun profil visible.');
      return;
    }
    runScansSequentially(visible.map((p) => p.slug));
  });

  await refreshAll();
  applyUrlOverridesAfterPayload();
  fitMapToVisibleData();

  if (state.payload.profiles.length === 0) {
    enterEditMode(null);
  }

  updateSyncPill();
  setInterval(updateSyncPill, 60 * 1000);
}

function bindPinModeToggle() {
  const btn = document.getElementById('pinmode-toggle');
  if (!btn) return;
  const reflect = () => {
    const detailed = getPinMode() === 'detailed';
    btn.setAttribute('aria-pressed', detailed ? 'true' : 'false');
    btn.title = detailed ? 'Vue compacte' : 'Vue détaillée';
    const icon = btn.querySelector('i');
    if (icon) icon.className = detailed ? 'fa-solid fa-tag' : 'fa-solid fa-circle-dot';
  };
  btn.addEventListener('click', () => {
    setPinMode(getPinMode() === 'detailed' ? 'compact' : 'detailed');
    reflect();
  });
  reflect();
}

function fitMapToVisibleData() {
  const visible = state.payload.listings.filter((l) =>
    Number.isFinite(l.lat) &&
    Number.isFinite(l.lon) &&
    !state.filter.hiddenProfiles.has(l.profileSlug)
  );
  if (visible.length > 0) {
    fitMapToPoints(visible.map((l) => [l.lat, l.lon]));
    return;
  }
  // No listings yet — fall back to profile area centroids.
  const areaPoints = [];
  for (const profile of state.payload.profiles) {
    if (state.filter.hiddenProfiles.has(profile.slug)) continue;
    for (const area of profile.areas || []) {
      if (Number.isFinite(area.lat) && Number.isFinite(area.lon)) {
        areaPoints.push([area.lat, area.lon]);
      }
    }
  }
  if (areaPoints.length > 0) fitMapToPoints(areaPoints, { singleZoom: 11, maxZoom: 12 });
}

async function refreshAll() {
  let payload = { profiles: [], listings: [] };
  try {
    const res = await fetch('/api/map-listings');
    payload = await res.json();
  } catch (err) {
    console.error('failed to load /api/map-listings', err);
  }
  state.payload = payload;

  for (const profile of payload.profiles) {
    setProfileVisibility(profile.slug, !state.filter.hiddenProfiles.has(profile.slug));
  }

  rerender();
}

function rerender() {
  const editing = isEditing();
  const visible = applyFilters(state.payload.listings, state.filter, Date.now());

  // Sync per-profile visibility BEFORE attaching markers, so attachMarker's
  // visibility gate doesn't skip listings of profiles that just got unhidden.
  for (const profile of state.payload.profiles) {
    setProfileVisibility(profile.slug, !state.filter.hiddenProfiles.has(profile.slug));
  }

  setListings(visible);

  // Filter / quick-sorts panels
  if (!editing) {
    renderProfilesPanel(
      { profiles: state.payload.profiles },
      state.filter,
      {
        onChange: applyFilterMutation,
        onAddProfile: () => enterEditMode(null),
        onEditProfile: (slug) => enterEditMode(slug)
      }
    );
    const visibleIgnoringStatus = applyFilters(
      state.payload.listings,
      { ...state.filter, statuses: null },
      Date.now()
    );
    renderQuickSorts(
      { listings: visible, statusCountListings: visibleIgnoringStatus },
      state.filter,
      { onChange: applyFilterMutation }
    );
    setPanelsVisible(true);
  } else {
    setPanelsVisible(false);
  }

  // Listings + detail panel
  if (!editing) {
    setListingsVisible(true);
    renderListings(visible, {
      onClick: (id) => handleRowClick(id),
      onHover: (id) => setHoveredRow(id),
      onAction: handleListingAction,
      onMarkViewed: markViewed
    });
  } else {
    setListingsVisible(false);
    closeDetailPanel();
  }

  // Bottom-bar stats reflect the unfiltered set so totals don't jump as filters change
  const unread = (state.payload.listings || []).filter((l) => !l.viewedAt).length;
  const total = (state.payload.listings || []).length;
  const totalEl = document.getElementById('stats-total');
  const unreadEl = document.getElementById('stats-unread');
  if (totalEl) totalEl.textContent = String(total);
  if (unreadEl) unreadEl.textContent = String(unread);
  document.getElementById('bottombar')?.classList.toggle('hidden', editing);
}

function applyFilterMutation(mutator) {
  const next = cloneFilter(state.filter);
  mutator(next);
  state.filter = next;
  persistFilterState(next);
  rerender();
}

// ─── Pin / row click ──────────────────────────────────────────────────────────

function handlePinClick(id) {
  const listing = getListing(id) || lookupInPayload(id);
  if (!listing) return;
  setSelectedMarker(id);
  highlightRow(id);
  markRowAsRead(id);
  queueViewed(id);
  openDetailPanel(decorateListing(listing));
  // Optimistically update payload so toggleRead etc. reflect immediately
  optimisticallyMarkViewed(id);
}

function handleRowClick(id) {
  const listing = getListing(id) || lookupInPayload(id);
  if (!listing) return;
  focusListing(id);
  setSelectedMarker(id);
  markRowAsRead(id);
  queueViewed(id);
  openDetailPanel(decorateListing(listing));
  optimisticallyMarkViewed(id);
}

function handlePinHover(id) {
  setHoveredRow(id);
}

function lookupInPayload(id) {
  return (state.payload.listings || []).find((l) => l.id === id) || null;
}

function decorateListing(listing) {
  // Inject profile title for the detail panel header.
  const profile = state.payload.profiles.find((p) => p.slug === listing.profileSlug);
  return {
    ...listing,
    profileTitle: profile?.shortTitle || profile?.label || listing.profileSlug
  };
}

function optimisticallyMarkViewed(id) {
  const idx = state.payload.listings.findIndex((l) => l.id === id);
  if (idx === -1) return;
  if (state.payload.listings[idx].viewedAt) return;
  state.payload.listings[idx] = {
    ...state.payload.listings[idx],
    viewedAt: new Date().toISOString()
  };
}

// ─── Listing actions (mark read, archive) ─────────────────────────────────────

async function handleListingAction(action, listing) {
  if (action === 'toggleRead') return toggleRead(listing);
  if (action === 'archive')    return setStatus(listing, 'archived',  { closeDetail: true });
  if (action === 'pursue')     return setStatus(listing, 'pursuing');
  if (action === 'sort')       return setStatus(listing, 'sorting');
}

async function toggleRead(listing) {
  const idx = state.payload.listings.findIndex((l) => l.id === listing.id);
  if (idx === -1) return;
  const current = state.payload.listings[idx];
  const newViewedAt = current.viewedAt ? null : new Date().toISOString();
  state.payload.listings[idx] = { ...current, viewedAt: newViewedAt };
  rerender();
  if (isDetailFor(listing.id)) {
    openDetailPanel(decorateListing(state.payload.listings[idx]));
  }

  // Server has only "mark viewed" (cannot un-set). Send the API only when transitioning to viewed.
  if (newViewedAt) {
    try {
      await fetch('/api/mark-viewed?profile=' + encodeURIComponent(listing.profileSlug), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [listing.id] })
      });
    } catch (err) {
      console.error('mark-viewed failed', err);
    }
  }
}

async function setStatus(listing, status, { closeDetail = false } = {}) {
  const idx = state.payload.listings.findIndex((l) => l.id === listing.id);
  if (idx !== -1) {
    state.payload.listings[idx] = { ...state.payload.listings[idx], status };
  }
  rerender();
  if (isDetailFor(listing.id)) {
    if (closeDetail) closeDetailPanel();
    else openDetailPanel(decorateListing(state.payload.listings[idx] || listing));
  }
  try {
    const res = await fetch('/api/update-status?profile=' + encodeURIComponent(listing.profileSlug), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: listing.id, status })
    });
    if (!res.ok) console.error('update-status failed', res.status);
  } catch (err) {
    console.error('update-status failed', err);
  }
}

async function clearVisibleListings() {
  const visible = applyFilters(state.payload.listings, state.filter, Date.now());
  if (visible.length === 0) return;

  const confirmed = window.confirm(
    'Marquer ' + visible.length + ' annonce' + (visible.length === 1 ? '' : 's') + ' comme lue' + (visible.length === 1 ? '' : 's') + ' et archivée' + (visible.length === 1 ? '' : 's') + ' ?'
  );
  if (!confirmed) return;

  const now = new Date().toISOString();
  const unviewedByProfile = new Map();
  const idsByProfile = new Map();

  for (const listing of visible) {
    if (!idsByProfile.has(listing.profileSlug)) idsByProfile.set(listing.profileSlug, []);
    idsByProfile.get(listing.profileSlug).push(listing.id);

    const idx = state.payload.listings.findIndex((l) => l.id === listing.id);
    if (idx === -1) continue;
    const current = state.payload.listings[idx];
    state.payload.listings[idx] = {
      ...current,
      status: 'archived',
      viewedAt: current.viewedAt || now
    };
    if (!current.viewedAt) {
      if (!unviewedByProfile.has(listing.profileSlug)) unviewedByProfile.set(listing.profileSlug, []);
      unviewedByProfile.get(listing.profileSlug).push(listing.id);
    }
  }

  rerender();
  closeDetailPanel();

  const requests = [];
  for (const [profileSlug, ids] of unviewedByProfile) {
    requests.push(
      fetch('/api/mark-viewed?profile=' + encodeURIComponent(profileSlug), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids })
      }).catch((err) => console.error('mark-viewed failed', err))
    );
  }
  for (const [profileSlug, ids] of idsByProfile) {
    requests.push(
      fetch('/api/update-status?profile=' + encodeURIComponent(profileSlug), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, status: 'archived' })
      }).catch((err) => console.error('update-status failed', err))
    );
  }
  await Promise.all(requests);
}

async function markViewed(ids) {
  // ids are debounced from listings-panel's IntersectionObserver; group by profile.
  const idSet = new Set(ids);
  const groups = new Map();
  for (const listing of state.payload.listings) {
    if (!idSet.has(listing.id)) continue;
    if (!groups.has(listing.profileSlug)) groups.set(listing.profileSlug, []);
    groups.get(listing.profileSlug).push(listing.id);
  }
  await Promise.all([...groups.entries()].map(([profileSlug, groupIds]) =>
    fetch('/api/mark-viewed?profile=' + encodeURIComponent(profileSlug), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: groupIds })
    }).catch((err) => console.error('mark-viewed failed', err))
  ));
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

async function runScansSequentially(slugs) {
  const button = document.getElementById('scan-button');
  const buttonText = document.getElementById('scan-button-text');
  if (button) button.classList.add('is-running');
  if (buttonText) buttonText.textContent = 'Scan en cours…';
  for (const slug of slugs) {
    await new Promise((resolve) => {
      startScan(slug, {
        onListing: (listing) => {
          state.payload.listings = upsertListing(state.payload.listings, listing);
          addListing(listing, { animate: true });
        },
        onScanDone: () => { refreshAll().finally(resolve); },
        onScanError: () => resolve()
      });
    });
  }
  if (button) button.classList.remove('is-running');
  if (buttonText) buttonText.textContent = 'Scanner';
  updateSyncPill();
}

function upsertListing(list, listing) {
  const idx = list.findIndex((l) => l.id === listing.id);
  if (idx === -1) return [...list, listing];
  const next = list.slice();
  next[idx] = { ...next[idx], ...listing };
  return next;
}

// ─── Profile edit lifecycle ───────────────────────────────────────────────────

async function handleEditStart({ profile, color, onCommuneToggle, onCommuneHover, onCommuneSelectMany }) {
  closeDetailPanel();
  await setEditMode({
    profile,
    color,
    onCommuneToggle,
    onCommuneHover,
    onCommuneSelectMany
  });
}

async function handleEditEnd() {
  await setEditMode(null);
}

async function handleZoneAdded(zone) {
  await addEditZone(zone);
}

function handleZoneRemoved(zone) {
  removeEditZone(zone);
}

async function handleZonesAdded(zones) {
  for (const zone of zones) {
    await addEditZone(zone);
  }
}

async function handleProfileSaved() {
  await refreshAll();
}

function handleEditClosed() {
  rerender();
}

// ─── Sync pill ────────────────────────────────────────────────────────────────

function updateSyncPill() {
  const text = document.getElementById('sync-pill-text');
  if (!text) return;
  const ts = freshestTimestamp(state.payload.listings || []);
  if (!ts) { text.textContent = 'pas encore synchronisé'; return; }
  text.textContent = 'synchronisé ' + relativeTime(ts);
}

function freshestTimestamp(listings) {
  let max = 0;
  for (const l of listings) {
    const candidates = [l.lastSeenAt, l.firstSeenAt, l.publishedAt].filter(Boolean);
    for (const c of candidates) {
      const t = Date.parse(c);
      if (Number.isFinite(t) && t > max) max = t;
    }
  }
  return max || null;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return 'il y a ' + min + ' min';
  const hours = Math.floor(min / 60);
  if (hours < 24) return 'il y a ' + hours + ' h';
  const days = Math.floor(hours / 24);
  return 'il y a ' + days + ' j';
}

// ─── Filter state persistence ────────────────────────────────────────────────

function cloneFilter(s) {
  return {
    hiddenProfiles: new Set(s.hiddenProfiles),
    recent: s.recent,
    unreadOnly: s.unreadOnly,
    statuses: new Set(s.statuses),
    priorities: s.priorities ? new Set(s.priorities) : null,
    sources: s.sources ? new Set(s.sources) : null
  };
}

function hydrateFilterState() {
  const fromStorage = readJson(localStorage.getItem(STATE_KEY));
  const base = defaultFilterState();
  if (!fromStorage) return base;
  return {
    hiddenProfiles: new Set(fromStorage.hiddenProfiles || []),
    recent: fromStorage.recent || base.recent,
    unreadOnly: !!fromStorage.unreadOnly,
    statuses: new Set(fromStorage.statuses || [...base.statuses]),
    priorities: null,
    sources: null
  };
}

function persistFilterState(s) {
  const serializable = {
    hiddenProfiles: [...s.hiddenProfiles],
    recent: s.recent,
    unreadOnly: s.unreadOnly,
    statuses: [...s.statuses]
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(serializable));
  syncUrl(s);
}

function syncUrl(s) {
  const params = new URLSearchParams(window.location.search);
  const visible = state.payload.profiles
    .map((p) => p.slug)
    .filter((slug) => !s.hiddenProfiles.has(slug));
  if (visible.length && visible.length < state.payload.profiles.length) {
    params.set('profiles', visible.join(','));
  } else {
    params.delete('profiles');
  }
  if (s.recent && s.recent !== 'any') params.set('recent', s.recent); else params.delete('recent');
  if (s.unreadOnly) params.set('unread', '1'); else params.delete('unread');

  const next = params.toString();
  const url = window.location.pathname + (next ? '?' + next : '');
  window.history.replaceState(null, '', url);
}

function applyUrlOverridesAfterPayload() {
  const params = new URLSearchParams(window.location.search);
  const profilesParam = params.get('profiles');
  if (profilesParam) {
    const requested = new Set(profilesParam.split(',').filter(Boolean));
    state.filter.hiddenProfiles = new Set(
      state.payload.profiles.map((p) => p.slug).filter((slug) => !requested.has(slug))
    );
  }
  const recent = params.get('recent');
  if (recent && ['1d', '3d', '7d', '14d'].includes(recent)) state.filter.recent = recent;
  if (params.get('unread') === '1') state.filter.unreadOnly = true;

  persistFilterState(state.filter);
  rerender();
}

function readJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

bootstrap().catch((err) => {
  console.error('bootstrap failed', err);
  alert('Erreur au démarrage: ' + err.message);
});
