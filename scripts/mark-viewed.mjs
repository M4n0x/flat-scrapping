export function applyViewedAt(tracker, ids, now) {
  const source = tracker && typeof tracker === 'object' ? tracker : { listings: [] };
  const idSet = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  if (!idSet.size) return { tracker: source, updated: 0 };

  const listings = Array.isArray(source.listings) ? source.listings : [];
  let updated = 0;
  const next = listings.map((listing) => {
    if (!idSet.has(listing.id)) return listing;
    updated += 1;
    return { ...listing, viewedAt: now };
  });

  return { tracker: { ...source, listings: next }, updated };
}
