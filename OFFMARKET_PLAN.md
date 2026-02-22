# Off-market roadmap (flat-scrapping)

## Objective
- Remove `homegate.ch` from product + pipeline.
- Add earlier signals before big portals by integrating direct-regie and institutional channels.

## Scope (v1)

### 1) Remove Homegate cleanly
- Remove Homegate toggle from profile UI.
- Remove Homegate from config defaults and profile update payload handling.
- Stop calling Homegate scraper in the scan pipeline.
- Update README / env docs.

### 2) Add off-market/early-market capability
- Add `listingStage` field on items:
  - `portal_market` (default portals)
  - `early_market` (direct regie feeds)
  - `off_market` (projects / pre-marketing signals)
- Display stage badges in dashboard.
- Adapt filtering logic so `off_market` items can appear even when rent/rooms are not yet fully known.

### 3) Provider rollout (prioritized)

#### P1 — Naef (direct listings)
- URL: `https://www.naef.ch/louer/appartements-maisons/`
- Viability: High
- Expected payload: inline `all_db_datas` dataset.
- Stage: `early_market`.

#### P1 — Retraites Populaires projects
- URL: `https://www.retraitespopulaires.ch/location/parc-immobilier-et-projets-neufs`
- Viability: High for early signal.
- Extract projects + URLs + city for targeted zones.
- Stage: `off_market`.

#### P2 — Retraites Populaires listing engine
- URL: `https://www.retraitespopulaires.ch/immobilier/louer/louer-un-appartement`
- Viability: Medium (depends on discoverable endpoint stability).
- Stage: `early_market`.

#### P2 — Bernard Nicod direct listings
- URL: `https://www.bernard-nicod.ch/louer?action=louer&transaction=buy`
- Viability: Medium (likely XHR endpoint reverse needed).
- Stage: `early_market`.

#### P3 — CIP/CPEV/CPEG institutional leads
- Mostly upstream / project / pre-inscription guidance.
- Stage: `off_market` leads, not necessarily structured listing feeds.

## Delivery order
1. ✅ Homegate removal + Naef + RP projects integrated (v1)
2. ✅ Hardening pass 1 (non-residential filtering, stage badges/priority)
3. ✅ RP engine + Bernard Nicod connector
   - ✅ Bernard Nicod direct listings connector added
   - ✅ RP listing-engine connector added (via Drupal settings `offers` feed)
4. ⏳ Institutional lead connectors and alerting enrichment

## Acceptance criteria for v1
- Homegate no longer visible in UI and no longer scraped.
- Scan succeeds with Naef + RP project sources.
- Dashboard shows stage badges (off-market / direct-regie).
- Existing profile filters remain compatible.
