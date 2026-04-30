# Apartment Search 🏠

Local dashboard for tracking apartment listings in Switzerland. Automatically scrapes listings from immobilier.ch, flatfox.ch, naef.ch, bernard-nicod.ch, Retraites Populaires direct rentals + projects (off-market), and anibis.ch, then displays them in a map-centric shell with status tracking, scoring, and cross-source deduplication.

## Prerequisites

- **Node.js 18+** (no npm dependencies to install)

## Getting Started

```bash
git clone <repo-url>
cd flat-scrapping
cp .env.example .env   # optional — only if you want a custom PORT
npm start
```

Open http://localhost:8787/ in your browser.

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: `8787`) |

> **Note:** current providers (immobilier.ch, flatfox.ch, naef.ch, bernard-nicod.ch, Retraites Populaires rentals/projects, anibis.ch) run without credentials.

## First Run

The app opens at `/`. Click the settings icon (left-sliding drawer) to create your first profile:

- **Title** — short profile name (e.g. "Vevey et environs")
- **Zones** — search and select Swiss municipalities via autocomplete (powered by [geo.admin.ch](https://api3.geo.admin.ch)). Canton, slug, and coordinates are derived automatically.
- **Budget** — min/max rent
- **Rooms / minimum surface**
- **Workplace address** — autocomplete search for distance calculation
- **Sources** — which feeds to enable (immobilier.ch, flatfox.ch, naef.ch, bernard-nicod.ch, Retraites Populaires locations directes + projets off-market, anibis.ch)

Each profile is independent with its own data and criteria.

## Usage

### Map Shell

The entire app lives at `/`. All profiles are shown simultaneously on an interactive map — each profile's pins are color-coded. Per-profile visibility is toggled via the sidebar.

**Sidebar filters:**
- Profiles (show/hide individual profiles)
- Recently found, unread
- Status: `sorting` / `pursuing` / `archived`
- Priority (A, A-, B)
- Sources

Clicking a pin opens a popup with key listing details. A listings panel on the right shows the full filtered list.

### Running a Scan

Two options:

1. **From the shell** — click "Lancer un scan" in the sidebar; pins drop live via SSE (`/api/run-scan-stream`).
2. **CLI**:
   ```bash
   npm run scan -- --profile=vevey
   ```

The scan fetches new listings, deduplicates (same listing across multiple sites = 1 entry), computes a score, and updates the tracker.

### Managing Profiles

Open the settings drawer (left-sliding panel) to create, edit, or delete profiles. All profiles are always visible on the map; use the sidebar toggle to focus on one at a time.

### Status Pipeline

Listings move through three states: `sorting → pursuing → archived`. The status can be changed via the row action menu in the listings panel.

> **Legacy migration:** profiles that were tracked with the old 7-state French pipeline (`À contacter`, `Visite`, `Dossier`, etc.) are automatically migrated to the 3-state schema on first access. The migration runs lazily, so no manual action is required.

## Project Structure

```
flat-scrapping/
├── dashboard/          # Frontend (HTML/CSS/JS, zero framework)
│   ├── index.html      # App shell (single entry point)
│   ├── app.js          # Root bootstrap + view orchestration
│   ├── map.js          # Leaflet map, pin rendering, popup
│   ├── sidebar.js      # Filter sidebar + profile toggles
│   ├── listings-panel.js # Right-side listings table/list
│   ├── scan.js         # SSE scan stream, live pin drops
│   ├── settings-drawer.js # Left-sliding profile CRUD drawer
│   ├── filter-logic.js # Pure filter/sort helpers
│   ├── map-utils.js    # Geo utilities (distance, bounds)
│   ├── tokens.css      # Design tokens
│   ├── components.css  # Reusable component styles
│   └── styles.css      # Layout and page-level styles
├── scripts/
│   ├── serve-dashboard.mjs   # HTTP server + API
│   └── scrape-immobilier.mjs # Multi-source scraper
├── data/
│   └── profiles/       # One folder per profile (gitignored)
│       └── {profile}/
│           ├── watch-config.json     # Configuration
│           ├── tracker.json          # Tracked listings (schemaVersion: 2)
│           ├── latest-listings.json  # Latest scan results
│           └── geocode-cache.json    # Geocoding cache
├── .env.example        # Environment variable template
└── package.json
```

## How It Works

1. **Scrape** — fetches listings from configured sources
2. **Deduplication** — by ID (intra-source), then by composite key address + rooms (floored) + surface (±5m²) + price (±50 CHF) for cross-source matching
3. **Scoring** — each listing gets a 0-100 score based on profile criteria
4. **Tracker** — listings are persisted and their status is tracked across scans
5. **Shell** — interactive map with sidebar filters, live scan pin drops, and listings panel

## Port

Default: `8787`. Configurable via the `PORT` environment variable:

```bash
PORT=3000 npm start
```
