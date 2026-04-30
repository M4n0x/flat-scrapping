import { migrateStatus, DEFAULT_STATUS } from './status.mjs';

export const TRACKER_SCHEMA_VERSION = 2;

function hasLegacyFields(input) {
  if (!input || typeof input !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(input, 'statuses')) return true;
  if (Array.isArray(input.listings)) {
    for (const listing of input.listings) {
      if (listing && Object.prototype.hasOwnProperty.call(listing, 'isRemoved')) return true;
    }
  }
  return false;
}

export function migrateTracker(input) {
  const source = input && typeof input === 'object' ? input : {};
  const isV2 = source.schemaVersion === TRACKER_SCHEMA_VERSION;
  const dirty = hasLegacyFields(source);

  if (isV2 && !dirty) {
    return { tracker: source, changed: false };
  }

  const listings = Array.isArray(source.listings) ? source.listings : [];
  const migratedListings = listings.map((listing) => {
    const next = { ...listing };
    const wasRemoved = next.isRemoved === true;
    delete next.isRemoved;

    if (wasRemoved) {
      next.status = 'archived';
    } else if (!isV2) {
      next.status = migrateStatus(next.status) || DEFAULT_STATUS;
    }
    // On v2 inputs without isRemoved, leave status as-is — it's already a v2 key.

    return next;
  });

  const tracker = { ...source, schemaVersion: TRACKER_SCHEMA_VERSION, listings: migratedListings };
  delete tracker.statuses;

  return { tracker, changed: true };
}
