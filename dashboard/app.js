import { initMap, setListings, addListing, focusListing, setProfileVisibility, onMarkerClick } from '/dashboard/map.js';
import { applyFilters, defaultFilterState } from '/dashboard/filter-logic.js';
import { renderSidebar } from '/dashboard/sidebar.js';
import { renderListings, highlightRow, markRowAsRead, queueViewed } from '/dashboard/listings-panel.js';
import { startScan, isScanActive } from '/dashboard/scan.js';
import { initDrawer, openDrawer } from '/dashboard/settings-drawer.js';

const STATE_KEY = 'apartment-ops:filter-state:v1';
const SOURCES = ['immobilier.ch', 'flatfox.ch', 'naef.ch', 'bernard-nicod.ch', 'retraitespopulaires.ch', 'anibis.ch'];

const state = {
  filter: hydrateFilterState(),
  payload: { profiles: [], listings: [] }
};

async function bootstrap() {
  initMap(document.getElementById('map'));
  initDrawer({ onProfilesChanged: refreshAll });

  await refreshAll();
  applyUrlOverridesAfterPayload();

  if (state.payload.profiles.length === 0) {
    openDrawer();
  }

  document.getElementById('scan-button').addEventListener('click', () => {
    if (isScanActive()) return;
    const visible = state.payload.profiles.filter((p) => !state.filter.hiddenProfiles.has(p.slug));
    if (visible.length === 0) {
      alert('Aucun profil visible.');
      return;
    }
    runScansSequentially(visible.map((p) => p.slug));
  });

  onMarkerClick((id) => {
    highlightRow(id);
    markRowAsRead(id);
    queueViewed(id);
  });
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

  renderSidebar({ profiles: payload.profiles, sources: SOURCES }, state.filter, (next) => {
    state.filter = next;
    persistFilterState(next);
    rerender();
  });

  rerender();
}

function rerender() {
  const visible = applyFilters(state.payload.listings, state.filter, Date.now());
  setListings(visible);
  renderListings(visible, {
    onClick: (id) => focusListing(id, { openPopup: true }),
    onHover: () => {},
    onMarkViewed: async (ids) => {
      const groups = groupIdsByProfile(ids);
      await Promise.all([...groups.entries()].map(([profileSlug, groupIds]) =>
        fetch('/api/mark-viewed?profile=' + encodeURIComponent(profileSlug), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: groupIds })
        }).catch((err) => console.error('mark-viewed failed', err))
      ));
    }
  });

  for (const profile of state.payload.profiles) {
    setProfileVisibility(profile.slug, !state.filter.hiddenProfiles.has(profile.slug));
  }
}

function groupIdsByProfile(ids) {
  const idSet = new Set(ids);
  const groups = new Map();
  for (const listing of state.payload.listings) {
    if (!idSet.has(listing.id)) continue;
    if (!groups.has(listing.profileSlug)) groups.set(listing.profileSlug, []);
    groups.get(listing.profileSlug).push(listing.id);
  }
  return groups;
}

async function runScansSequentially(slugs) {
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
}

function upsertListing(list, listing) {
  const idx = list.findIndex((l) => l.id === listing.id);
  if (idx === -1) return [...list, listing];
  const next = list.slice();
  next[idx] = { ...next[idx], ...listing };
  return next;
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
    priorities: new Set(fromStorage.priorities || [...base.priorities]),
    sources: fromStorage.sources ? new Set(fromStorage.sources) : null
  };
}

function persistFilterState(s) {
  const serializable = {
    hiddenProfiles: [...s.hiddenProfiles],
    recent: s.recent,
    unreadOnly: s.unreadOnly,
    statuses: [...s.statuses],
    priorities: [...s.priorities],
    sources: s.sources ? [...s.sources] : null
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
