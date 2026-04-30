export function defaultFilterState() {
  return {
    hiddenProfiles: new Set(),
    recent: 'any',
    unreadOnly: false,
    statuses: new Set(['sorting', 'pursuing']),
    priorities: new Set(['A', 'A-', 'B']),
    sources: null
  };
}

const RECENT_TO_MS = {
  any: null,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000
};

export function applyFilters(listings, state, nowMs = Date.now()) {
  const recentWindow = RECENT_TO_MS[state.recent] ?? null;
  return listings.filter((listing) => {
    if (state.hiddenProfiles && state.hiddenProfiles.has(listing.profileSlug)) return false;
    if (recentWindow != null) {
      const t = listing.firstSeenAt ? Date.parse(listing.firstSeenAt) : NaN;
      if (!Number.isFinite(t) || nowMs - t > recentWindow) return false;
    }
    if (state.unreadOnly && listing.viewedAt) return false;
    if (state.statuses && !state.statuses.has(listing.status)) return false;
    if (state.priorities && listing.priority && !state.priorities.has(listing.priority)) return false;
    if (state.priorities && !listing.priority) return false;
    if (state.sources && !state.sources.has(listing.source)) return false;
    return true;
  });
}
