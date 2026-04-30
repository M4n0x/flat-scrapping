# Global Apartment Map Design

## Goal

Add a global map overview to the home page so the user can see all active, displayed apartment listings across every profile. Each profile has visually distinct pins, profiles can be hidden or shown from the map, and pins support a low-detail and high-detail display mode.

## Scope

Included:

- A top-level `Carte globale` tab on the home page (`/`) next to the existing profile-management view.
- A Leaflet map using OpenStreetMap tiles loaded in the browser.
- A server endpoint that aggregates map-ready listings from all profiles.
- Stable automatic colors per profile, derived from the profile slug.
- Profile filter checkboxes that hide or show pins for each profile.
- A manual marker detail toggle with two modes:
  - `Points`: compact colored point markers.
  - `Détails`: markers showing price, rooms, and surface.
- Read-only marker popups with profile, title or address, price, rooms, size, source, and the original listing link.
- Coordinate persistence for newly scanned listings.

Excluded for the first version:

- Status editing from the map popup.
- Configurable profile colors.
- Showing removed listings, refused listings, or listings hidden by profile filters.
- Server-side calls to external geocoding services from the map endpoint.

## User Experience

The home page gets two tabs:

- `Profils`: the existing profile cards and create/edit profile form.
- `Carte globale`: the new map overview.

The map tab layout has a control panel and a map area:

- The control panel lists all profiles with a checkbox, profile title, count of mapped active listings, and the profile color swatch.
- A segmented control switches marker mode between `Points` and `Détails`.
- A small map status line shows the number of visible flats and any skipped listings without coordinates.

Default behavior:

- All profiles are visible on first load.
- Marker mode defaults to `Points`.
- The map fits bounds to visible markers after initial load and when profile filters change.
- Switching marker detail mode redraws markers without forcibly changing the current pan or zoom.
- Profile visibility and detail mode persist in `localStorage`.

Empty states:

- If no profiles have active displayed listings, show a map-panel message explaining that no active listings are available.
- If active listings exist but none have coordinates, show that coordinates will appear after the next scan or distance recomputation.

## Data Model

The scraper should persist map coordinates on listings when distance computation already resolves a listing location:

```json
{
  "mapLat": 46.5197,
  "mapLon": 6.6323,
  "mapAddress": "Rue de Bourg 1, Lausanne, Suisse"
}
```

`mapLat` and `mapLon` are numeric WGS84 coordinates suitable for Leaflet. `mapAddress` is the query address that produced those coordinates and is used for debugging and cache lookup consistency.

The existing `geocode-cache.json` remains the cache source. The map API may read from it to recover coordinates for already-tracked listings when `mapLat/mapLon` are absent, using the same address-query shape as the scraper. It must not call Nominatim, Photon, or any other external geocoder.

## API Design

Add `GET /api/map-listings`.

Response shape:

```json
{
  "generatedAt": "2026-04-29T17:30:00.000Z",
  "profiles": [
    {
      "slug": "vevey",
      "title": "Vevey et environs",
      "color": "#56d4b8",
      "totalActiveDisplayed": 8,
      "mappedCount": 7,
      "missingCoordinates": 1
    }
  ],
  "listings": [
    {
      "id": "immobilier:123",
      "profileSlug": "vevey",
      "profileTitle": "Vevey et environs",
      "profileColor": "#56d4b8",
      "title": "Appartement 2.5 pièces",
      "address": "Rue Example 1, 1800 Vevey",
      "area": "Vevey",
      "totalChf": 1450,
      "rooms": 2.5,
      "surfaceM2": 62,
      "source": "immobilier.ch",
      "url": "https://example.test/listing",
      "lat": 46.461,
      "lon": 6.842
    }
  ],
  "totals": {
    "profiles": 3,
    "activeDisplayed": 21,
    "mapped": 18,
    "missingCoordinates": 3
  }
}
```

Filtering rules:

- Include only listings from profile tracker data where:
  - `active !== false`
  - `display !== false`
  - `isRemoved !== true`
  - `status !== "Refusé"`
- Skip listings without valid coordinates.
- Use `mapLat/mapLon` first.
- If missing, look up `geocode-cache.json` using the listing address query. If valid cached coordinates are found, include the listing in the response.

The endpoint returns a compact map-specific payload rather than full tracker records.

## Frontend Design

`dashboard/home.html`:

- Add Leaflet CSS in the page head.
- Add a tab navigation container above the profile grid.
- Wrap the existing profile UI in a `Profils` panel.
- Add a `Carte globale` panel with:
  - profile filter container
  - marker mode segmented control
  - status line
  - map container
- Add Leaflet JS before `home.js` so map initialization can rely on `window.L` when the map tab opens.

`dashboard/home.js`:

- Keep existing profile-management behavior.
- Add tab switching with localStorage persistence.
- Fetch `/api/map-listings` when the map tab is first opened, and refresh it after scan-all finishes.
- Generate stable profile colors from slug using a deterministic hash into a curated color palette.
- Render profile filters from the API profiles list.
- Render Leaflet markers based on currently visible profiles and marker mode.
- Use custom `L.divIcon` markers:
  - `Points`: small colored dot with white outline.
  - `Détails`: compact colored label with price, rooms, and surface.
- Bind read-only popups with escaped content and an external listing link.

`dashboard/home.css`:

- Add styles for the home tabs, map layout, filter panel, marker mode control, map status line, and custom marker icons.
- Preserve the current visual language: dark operational UI, compact controls, and restrained colors.
- Keep the map height stable across desktop and mobile with responsive constraints.

## Coordinate Persistence

Update `scripts/scrape-immobilier.mjs`:

- When `computeDistanceFromWork()` returns `computed: true`, copy `distanceMeta.listingCoords.lat` to `item.mapLat`, `distanceMeta.listingCoords.lon` to `item.mapLon`, and `distanceMeta.listingAddress` to `item.mapAddress`.
- When merging with an existing tracker item, preserve existing map coordinates if the current scan cannot recompute them.
- For newly created listings, write map coordinates when available.
- For old listings carried forward through missing-scan handling, preserve existing map coordinate fields.

Update `scripts/recompute-distances.mjs` in the same way so manual distance recomputation backfills map coordinates.

## Error Handling

- If Leaflet fails to load, the map panel shows a clear French error message and keeps the profile-management tab functional.
- If `/api/map-listings` fails, show an inline error in the map tab with a retry button.
- If no visible markers remain after filters are applied, keep the map open and show a small empty-state message in the control panel.
- The API tolerates missing profile files and malformed profile data by skipping that profile rather than failing the whole response.

## Testing

Manual checks:

- Start the dashboard and open `/`.
- Confirm the `Profils` tab still works for profile creation, editing, deleting, and scan-all.
- Open `Carte globale` and confirm the map loads.
- Confirm all profiles appear in the filter list with stable colors.
- Toggle profile visibility and confirm markers hide/show.
- Switch `Points` and `Détails` and confirm marker labels update.
- Click markers and verify popup content and listing links.
- Verify the map handles no-listing and no-coordinate states.

Command checks:

```bash
node --check scripts/serve-dashboard.mjs
node --check scripts/scrape-immobilier.mjs
node --check scripts/recompute-distances.mjs
node --check dashboard/home.js
```

If implementation changes browser behavior substantially, run the local server and inspect the page in a browser.
