# Remove Pearls, Plan B, And Extra Budget Thresholds Design

## Goal

Remove the unused pearl detection, Plan B/studio fallback, hard budget threshold, and pearl threshold features. After this change, `Loyer max (CHF)` is the only budget ceiling for visible normal listings.

## Scope

- Remove profile form controls for `Seuil dur`, `Seuil perle`, pearl detection, and Plan B.
- Remove dashboard filters/cards for pearls and Priority B.
- Stop writing removed settings when profiles are created or updated.
- Stop using removed settings in scraper classification and display eligibility.
- Update current documentation so removed concepts are not described as active behavior.

## Behavior

Listings remain visible only when they pass the existing type, publication age, location, and non-speculative filters. For normal market listings, they must also be at or below `filters.maxTotalChf`, at or above `filters.minTotalChf`, and satisfy the minimum rooms/surface criteria. Listings below the minimum room count no longer qualify through Plan B. Listings above `filters.maxTotalChf` no longer qualify as pearls.

Priority values are simplified to `A`, `A-`, and `B`. `A★` is no longer assigned. `B` can remain as a low-priority classification for non-visible or low-priority listings, but it is not exposed as a dedicated Plan B feature in the UI.

## Compatibility

Existing `watch-config.json` files may still contain stale keys such as `maxTotalHardChf`, `maxPearlTotalChf`, `allowStudioTransition`, or `pearl`. The application should ignore those keys after this change. The implementation does not need a data migration.

## Testing

Add focused `node:test` coverage for listing filtering/classification helpers:

- A listing above `maxTotalChf` is not budget-eligible even if it would previously have been a pearl.
- A listing below minimum rooms is not size-eligible even if `allowStudioTransition` is present in a stale config.
- Priority classification no longer emits `A★`.
