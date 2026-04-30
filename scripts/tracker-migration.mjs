import { migrateStatus, DEFAULT_STATUS } from './status.mjs';

export const TRACKER_SCHEMA_VERSION = 2;

export function migrateTracker(input) {
  const source = input && typeof input === 'object' ? input : {};
  if (source.schemaVersion === TRACKER_SCHEMA_VERSION) {
    return { tracker: source, changed: false };
  }

  const listings = Array.isArray(source.listings) ? source.listings : [];
  const migratedListings = listings.map((listing) => {
    const next = { ...listing };
    const wasRemoved = next.isRemoved === true;
    delete next.isRemoved;

    if (wasRemoved) {
      next.status = 'archived';
    } else {
      next.status = migrateStatus(next.status) || DEFAULT_STATUS;
    }

    return next;
  });

  const tracker = { ...source, schemaVersion: TRACKER_SCHEMA_VERSION, listings: migratedListings };
  delete tracker.statuses;

  return { tracker, changed: true };
}
