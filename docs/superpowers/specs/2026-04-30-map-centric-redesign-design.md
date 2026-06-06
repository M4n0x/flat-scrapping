# Map-centric redesign

**Status:** Draft
**Date:** 2026-04-30
**Scope:** Replace the per-profile dashboard + home page with a single map-centric application shell.

## Goal

Make the map the entire application. All profiles are shown on a single map by default, color-coded. Filters live in a left sidebar. A right-hand panel lists currently-visible listings. Scans stream live progress, with new pins literally dropping onto the map as the scraper finds them. Profile management lives in a settings drawer; the standalone home page is retired.

## Non-goals (v1)

- Mobile bottom-sheet polish — basic responsive only; full mobile re-layout is a follow-up.
- Marker hover tooltips beyond what Leaflet ships out of the box.
- In-UI scan cancellation. Backend will support it; the button ships in a follow-up.
- Adding new scrapers, scoring changes, deduplication changes.

## App shell and routing

- **`/` is the only route.** It serves the map shell. The home page is removed.
- **No `/{slug}/dashboard` route.** Old URLs respond with `302` to `/?profiles={slug}` so any bookmarks land with that profile pre-selected in the visibility filter.
- **All profiles visible by default.** Listings from every profile appear on the map, color-coded via the existing `profileColor()` palette.
- **URL state.** Map center, zoom, and filter state sync to the query string (`?center=lat,lon&zoom=12&profiles=a,b&status=sorting,pursuing&unread=1&recent=7d`) via `history.replaceState`. No router framework.
- **First run (zero profiles).** The settings drawer auto-opens with focus on "Create your first profile". No empty-state map screen.
- **Layers stacked on the map:**
  1. Map canvas (Leaflet, fullscreen).
  2. Topbar — minimal: brand, "Scanner" button, scan status when running.
  3. Left sidebar — filters and settings entry.
  4. Right listings panel — virtualized list of currently-visible listings.

## Left sidebar (filters)

Top-to-bottom order, each section collapsible:

1. **Profiles** — one row per profile: `[colored dot] [name] [eye icon]`. Eye toggles that profile's pins on the map and rows in the right panel. State persists in localStorage.
2. **Recently found** — single select: *Any time* (default), *Last 24h*, *Last 3 days*, *Last 7 days*, *Last 14 days*. Filters by `firstSeenAt` on the tracker entry.
3. **Unread** — toggle: *Show only unread*. "Unread" = tracker entry has no `viewedAt` timestamp.
4. **Status** — three checkboxes: *Sorting*, *Pursuing*, *Archived*. Default: Sorting + Pursuing checked, Archived unchecked.
5. **Priority** — three checkboxes: *A*, *A-*, *B*. Default: all checked.
6. **Sources** — checkbox per source: immobilier.ch, flatfox.ch, naef.ch, bernard-nicod.ch, retraites-populaires (locations + projets), anibis.ch. Default: all checked.

Bottom of the sidebar: **Settings** button (opens the drawer). The "Scanner" button sits in the topbar so it stays reachable when the sidebar is collapsed to its icon rail.

All filters are applied client-side. The server returns the full listings set per visible profile; the sidebar narrows what is rendered on the map and in the listings panel. Filter state persists in localStorage and the URL query string.

Zones are intentionally *not* a sidebar filter. A profile is defined by its zones, so toggling a profile's visibility implicitly toggles its zones. Zone management lives in the settings drawer's profile editor.

## Right listings panel

- Virtualized scrollable list. Each row mirrors the existing dashboard row (thumbnail, title, address, price · rooms · surface, score, status pill, action menu) but compact — designed for triage at a desk.
- **Map ↔ list sync:** hovering a row pulses the corresponding marker; clicking a marker scrolls the row into view in the panel and opens the popup. Click a row to open the popup as if the marker had been clicked.
- **Unread indicator:** a left-edge accent on rows whose tracker entry has no `viewedAt`.
- **Viewed-at tracking:** when a row is in the viewport for more than one second, or when its popup is opened, the client batches its id into a 2-second debounced `POST /api/mark-viewed` call. The server sets `viewedAt = now` on each id.
- **Pin/unpin** and **Status change** actions remain available via a row action menu, mirroring today's behavior. The status select renders the new 3-state set.

## Map behavior

- **Library:** Leaflet, loaded from CDN. (Already in use for popups today; same approach.)
- **Tile layer:** OpenStreetMap default. No new credentials.
- **Markers:** custom HTML marker with the profile color, dropped at the listing's lat/lon. Listings without coordinates are skipped on the map (still appear in the right panel with a "no coords" badge).
- **Clustering:** Leaflet.markercluster (CDN). Markers render in two modes driven by zoom level. **At and above a detail-zoom threshold (initial value: zoom 13)**, markers are full detail pins, and Leaflet.markercluster collapses any pair whose icons overlap on screen. **Below the threshold**, every listing renders as an unclustered small colored dot — clustering is disabled in this mode because dots are small enough that overlap reads as density. The threshold is a constant in the client; tunable later.
- **Drop animation:** new pins from a live scan use a brief drop + pulse animation; existing pins do not animate on filter changes.
- **Popup:** existing `popupHtml()` from `dashboard/map-utils.js` is reused. Status-control colors inside the popup are updated for the 3-state set.

## Live scan (events, SSE, pin drops)

### Scraper changes (`scripts/scrape-immobilier.mjs`)

- New CLI flag `--events-fd=<n>`. When present, the scraper writes NDJSON events to that file descriptor. When absent (the cron / `npm run scan` path), no events are emitted and behavior is unchanged.
- A small helper `emitEvent(obj)` lazily opens a writable stream on the configured fd. When no fd is set, it is a no-op. The helper writes a single JSON object per line.
- Event types:
  - `{type:"scan-start", profile, sources, at}` — once at the top of the scan.
  - `{type:"source-start", source, at}` — entering a source loop.
  - `{type:"source-progress", source, page, totalPages?, found}` — emitted at most once per page (or batched if pages flush in bursts).
  - `{type:"listing", listing}` — per listing inserted or updated. `listing` contains the popup-ready fields (`id, lat, lon, profile, title, address, area, totalChf, rooms, surfaceM2, source, url, imageUrls`) plus `firstSeenAt` so the client can update its store.
  - `{type:"source-done", source, found, kept, errored, at}` — exiting a source loop.
  - `{type:"scan-done", summary, at}` — once at the end.
  - `{type:"scan-error", message, at}` — fatal scan errors only (per-listing parse errors are folded into the source's `errored` count).

Event-emit calls are inserted at known points: top of `main()`, top/bottom of each per-source loop, after each tracker upsert, end of `main()`. No emit calls inside hot per-listing parse paths beyond the upsert hook.

### Server changes (`scripts/serve-dashboard.mjs`)

- New endpoint `GET /api/run-scan-stream?profile=<slug>` — SSE (`Content-Type: text/event-stream`).
- Spawns the scraper with `stdio: ['ignore','pipe','pipe','pipe']` and `--events-fd=3`. Reads fd 3 line-by-line, forwards each NDJSON line as an SSE `data:` frame. Closes the stream on `scan-done`, on child exit, or when the client disconnects (in which case the child is killed).
- Concurrency: an in-memory `Map<slug, child>` tracks active scans. A second start request for the same slug returns `409 Conflict`. The map entry is cleared on child exit.
- The existing `POST /api/run-scan` (synchronous) stays as-is. `/api/run-scan-all` continues to use it. The cron path (`npm run scan -- --profile=…`) is unchanged.

### Client changes (`dashboard/app.js`)

- The "Scanner" button opens an `EventSource('/api/run-scan-stream?profile=' + slug)`.
- A **map progress overlay** appears: a slim card pinned to the top of the map showing the current source, page count, and a running `+N` of new listings found. A thin progress bar below the card animates while the scan runs.
- On every `listing` event: upsert into the in-memory store, drop a marker on the map with the drop+pulse animation, prepend a row in the right panel marked as new (left-edge accent + brief highlight).
- Per-source non-fatal errors surface as small toasts. `scan-error` closes the stream and shows a banner with a retry button.
- "Scan all" iterates visible profiles sequentially with one stream open at a time; the progress overlay updates the profile name between iterations.

## Status simplification, unread tracking, migration

### New status set

- `sorting` — needs triage. Default for newly-found listings.
- `pursuing` — actively going for it.
- `archived` — done with. Auto-removed listings (today's `isRemoved: true`) collapse into this state.

The `isRemoved` flag is removed from the data model; the auto-removal logic in the scraper sets `status: 'archived'` instead.

### Unread tracking

- New optional field on each tracker entry: `viewedAt` (ISO string, optional). Missing or null = unread.
- The client sets it on: marker click (popup opens), listing row clicked, or row visible in the viewport for more than 1 second. The client batches ids into a debounced `POST /api/mark-viewed` call (body `{ids: string[]}`) every 2 seconds while the user interacts.
- The "Unread" sidebar filter tests `!viewedAt`.

### One-time migration

On `ensureProfileStorage()`, if the tracker root lacks `schemaVersion: 2`, rewrite each entry once:

- `À contacter` → `sorting`
- `Visite`, `Dossier`, `Relance`, `Accepté` → `pursuing`
- `Refusé`, `Sans réponse` → `archived`
- `isRemoved: true` → status `archived`, drop the `isRemoved` field

Then set `schemaVersion: 2` on the tracker root and write atomically. `viewedAt` is left absent — every existing listing starts as unread, which the user can clear in bulk if desired. Forward-only; no rollback (data is local and gitignored).

### API changes

- `POST /api/update-status` validates the new 3-value enum and rejects unknown statuses with `400`.
- `POST /api/mark-viewed` (new) accepts `{ids: string[]}` and sets `viewedAt = new Date().toISOString()` on each matching tracker entry.

## Settings drawer (replaces home page)

### Entry points

- "Settings" button at the bottom of the left sidebar.
- Auto-opens on first run when zero profiles exist.
- Keyboard: `,` to open, `Esc` to close.

### Layout

A slide-in drawer from the left, ~480px wide, full height. Two views:

1. **List view (default).** Header "Profils" + a "Nouveau profil" primary button. One row per profile: `[colored dot] [name] [zone count · max budget]` with a chevron. Click a row to open its editor.
2. **Editor view.** Same form fields as today's `home.js` form: title, zones (autocomplete via `geo.admin.ch`), budget min/max, rooms, minimum surface, workplace address, sources, preferences (`missingScansBeforeRemoved` etc.). A back button returns to the list. Footer: Save / Delete (with confirm) / Cancel. Saving keeps the drawer open and returns to the list. Deleting removes the profile from the visibility list and from the map immediately.

The drawer dismisses via overlay click, Esc, or the close button. Closing returns focus to the trigger element.

### What is retired

- `dashboard/home.html`, `dashboard/home.js`, `dashboard/home.css` — deleted.
- The server's `/` route now serves the map shell (`index.html`) instead of `home.html`.
- Any CSS in `home.css` that was specific to the home layout is dropped. Rules that overlap with reusable components (dialog, form fields, autocomplete) are lifted into `components.css` only if a token does not already cover them.

## File-level changes

### Frontend

- `dashboard/index.html` — rewritten as the map shell. Topbar, left sidebar, Leaflet container, right listings panel, settings drawer markup. The standalone scan dialog is removed (replaced by the inline progress overlay).
- `dashboard/app.js` — heavily edited. Inline sections organized by responsibility:
  - **state** — in-memory listings store + URL/localStorage sync.
  - **map** — Leaflet init, marker layer, zoom-conditional clustering, drop animations.
  - **sidebar** — filter rendering and event handlers.
  - **listings-panel** — virtualized list, hover ↔ marker sync, `viewedAt` batching.
  - **scan** — `EventSource` client and progress overlay rendering.
  - **settings-drawer** — profile CRUD UI lifted from `home.js`.
  - The Kanban code path is deleted in full.
- `dashboard/styles.css` — rewritten for the new shell. Tokens (`tokens.css`) and `components.css` are reused where they already fit.
- `dashboard/components.css` — status pill colors updated for the 3-state set; small additions for sidebar, drawer, and progress overlay components only if existing tokens are insufficient.
- `dashboard/map-utils.js` — kept. `popupHtml()` already produces the markup used in the popup; no structural change.
- `dashboard/home.html`, `dashboard/home.js`, `dashboard/home.css` — deleted.
- Leaflet and Leaflet.markercluster are loaded from CDN. Zero-npm-dependency policy preserved.

### Backend

- `scripts/serve-dashboard.mjs`:
  - `/` serves `dashboard/index.html`.
  - `/{slug}/dashboard` issues `302 → /?profiles={slug}`.
  - `GET /api/run-scan-stream?profile=` (new SSE endpoint).
  - `POST /api/mark-viewed` (new).
  - `POST /api/update-status` validates the new enum.
  - `ensureProfileStorage()` runs the one-time migration when `schemaVersion < 2`.
  - In-memory `activeScans: Map<slug, ChildProcess>` for stream concurrency.
- `scripts/scrape-immobilier.mjs`:
  - `--events-fd=<n>` flag parsed.
  - `emitEvent()` helper opens fd lazily; no-op when unset.
  - Event-emit calls inserted at scan-start, per-source-start, per-source-progress (throttled), per-listing upsert, per-source-done, scan-done, scan-error.
  - New listings are written with `status: 'sorting'`.
  - Auto-removal sets `status: 'archived'` instead of `isRemoved: true`.

### Docs

- `README.md` and `AGENTS.md` updated to reflect: single-route map shell, new status set, `/api/run-scan-stream` endpoint, `/api/mark-viewed` endpoint, no home page, migration note, retired routes.

## Risks and mitigations

- **Scraper diff size.** The scraper file is large (~2500 lines). Mitigation: emit calls go in at well-known boundaries (loop edges + the existing tracker upsert site), with a single `emitEvent()` helper. No restructuring of source-specific parsing.
- **Migration correctness on live data.** The migration runs once per profile; an interrupted process could leave `schemaVersion: 2` set without a complete rewrite if writes are not atomic. Mitigation: write to `tracker.json.tmp` then rename. The set of source statuses is closed and known; any unmapped value is logged and left untouched (forward-only safety).
- **SSE behind dev proxies / pm2.** SSE needs no buffering. Mitigation: set `Cache-Control: no-cache` and `X-Accel-Buffering: no` on the response; flush after each frame.
- **Scraper crashes mid-stream.** The child process may exit non-zero before emitting `scan-done`. Mitigation: the SSE handler always emits a `scan-error` frame on non-zero exit and closes the stream.
- **Marker volume.** Hundreds of pins per profile × many profiles can hurt frame rate. Mitigation: clustering at low zoom; small-dot markers below the cluster threshold; defer popup HTML construction until first open.
- **Backwards-incompatible API enum.** External callers (if any) that POST old French status strings to `/api/update-status` break. Mitigation: this is a single-user local app; document the change in `AGENTS.md`.

## Open follow-ups (not v1)

- Mobile bottom-sheet for the listings panel; sidebar morphs into a bottom action bar.
- "Cancel scan" button wired to the active stream.
- "Mark all as read" bulk action.
- Map-area filter ("only listings within current viewport").
