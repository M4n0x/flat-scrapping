# AGENTS.md — Apartment Search

Guide for any AI agent working on this project.

## Overview

Local dashboard (zero-deps, pure Node.js) for tracking apartment listings in Switzerland. Multi-source scraping (immobilier.ch, flatfox.ch, homegate.ch, anibis.ch), cross-source deduplication, scoring, and status pipeline tracking.

## Architecture

```
apartment-search/
├── scripts/
│   ├── serve-dashboard.mjs     # HTTP server + REST API (port 8787)
│   ├── scrape-immobilier.mjs   # Multi-source scraper (~2500 lines)
│   └── recompute-distances.mjs # Distance/travel time recalculation
├── dashboard/
│   ├── home.html / home.js / home.css  # Home page + profile management
│   ├── index.html / app.js / styles.css # Per-profile dashboard
├── data/
│   └── profiles/{slug}/        # One folder per profile (gitignored)
│       ├── watch-config.json   # Profile configuration
│       ├── tracker.json        # Tracked listings (persistent)
│       ├── latest-listings.json # Latest scan results
│       ├── geocode-cache.json  # Geocoding cache
│       └── route-cache.json    # Travel route cache
├── .env.example                # Environment variable template
└── package.json
```

## Stack

- **Runtime:** Node.js 18+ (ESM modules, zero npm dependencies)
- **Frontend:** Vanilla JS, no framework, no bundler
- **Backend:** Native HTTP server (`node:http`)
- **Data:** JSON files in `data/profiles/`
- **Geocoding:** Swiss Federal API (`api3.geo.admin.ch`) for zone and address autocomplete

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:`, etc.)
- **Branch:** Work directly on `main`
- **Style:** No linter configured, but keep consistency with existing code
- **Language:** Code, comments, and documentation in English. UI labels in French (target audience is French-speaking Switzerland).

## Key Concepts

### Profiles
Each profile is independent: its own zones, budget, sources, and data. Stored in `data/profiles/{slug}/`. Slug format: `[a-z0-9-]+`.

Zones are selected via autocomplete (geo.admin.ch `gg25` origin = Swiss municipalities). Each zone stores: `slug`, `label`, `canton`, `lat`, `lon`.

### How Zones Map to Sources

Each scraping source uses zone data differently:

| Source | Uses | Details |
|--------|------|---------|
| **immobilier.ch** | `slug` + `canton` | URL pattern: `/fr/louer/appartement/{canton}/{slug}/page-N` |
| **flatfox.ch** | `label` + `slug` | Flatfox API `area` param accepts city names with accents |
| **homegate.ch** | `label` (geocoded) | Label geocoded to coordinates, then radius search via API |
| **anibis.ch** | `label` | Free-text search query |

### Deduplication

Two levels:

1. **By ID** — same source, same listing
2. **Cross-source** — composite key built from:
   - **Address** — normalized (lowercase, no postal code, sorted parts)
   - **Rooms** — floored (2.5 → 2, 3.5 → 3) to handle cross-platform inconsistencies
   - **Surface** — rounded to nearest 5 m² (62 → 60)
   - **Price** — total rent (gross), rounded to nearest 50 CHF

   Keeps the listing with the best quality rank (source priority + data completeness + image count).

### Scoring
Each listing gets a 0-100 score based on profile criteria (budget, rooms, surface, distance, travel time). `scoreBreakdown` contains the detail.

### Priority
- **A** — within budget + enough rooms
- **A-** — within hard budget + enough rooms
- **A★ (perle)** — above hard budget but matches pearl criteria (configurable keywords, min rooms/surface)
- **B** — studios or below minimum rooms (only shown if "plans B" enabled)

### Pearl Detection

Configurable per profile (`filters.pearl`):
- `enabled` — toggle on/off
- `minRooms` / `minSurfaceM2` — minimum thresholds
- `keywords` — list of quality signals to look for in listing text
- `minHits` — how many keywords must match

Price must be between `maxTotalHardChf` and `maxPearlTotalChf`.

### Status Pipeline
`À contacter → Visite → Dossier → Relance → Accepté / Refusé / Sans réponse`

### Removed Listings
When a listing hasn't appeared for N scans (`missingScansBeforeRemoved`), it's marked `isRemoved: true`. Shown in the kanban under "Retirées".

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HOMEGATE_API_USERNAME` | Only for homegate.ch | API username |
| `HOMEGATE_API_PASSWORD` | Only for homegate.ch | API password |
| `HOMEGATE_SECRET` | Only for homegate.ch | HMAC signing secret |
| `PORT` | No | Server port (default: `8787`) |

immobilier.ch, flatfox.ch, and anibis.ch require no credentials.

## REST API

All data routes take `?profile={slug}`.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/profiles` | List profiles with stats (listing count, max rent) |
| GET | `/api/profile/detail?profile=` | Full profile config |
| POST | `/api/profile/create` | Create a profile (body: slug, shortTitle, areas, sources, filters, preferences) |
| POST | `/api/profile/update` | Update a profile |
| POST | `/api/profile/delete` | Delete a profile and all its data |
| GET | `/api/state?profile=` | Tracker + latest scan results |
| POST | `/api/update-status?profile=` | Change listing status/notes |
| POST | `/api/delete-listing?profile=` | Delete a listing from tracker |
| POST | `/api/run-scan?profile=` | Trigger a scan |

## Frontend Routes

| Route | Page |
|-------|------|
| `/` | Home — profile management (create, edit, delete) |
| `/{slug}/dashboard` | Per-profile dashboard (table + kanban views) |

## Common Pitfalls

- **pm2** manages the server in production. After modifying server code: `pm2 restart apartment-search-web`. Don't kill the process manually.
- **No npm deps** — everything uses native Node.js modules. Don't add dependencies without a good reason.
- **`data/` is gitignored** — all profile data is local-only. Only code is versioned.
- **The scraper is large** (~2500 lines). It handles 4 sources, each with its own parsing quirks. Modify with care.
- **`ensureProfileStorage()`** auto-creates the profile directory when accessing a dashboard. For API-created profiles, `buildConfigFromPayload()` generates the config.
- **geo.admin.ch** is used for both zone selection (municipalities, `origins=gg25`) and workplace address autocomplete (all location types). No API key needed.
- **Flatfox area tokens** — use the original city name (with accents/spaces), not the slug. The slug often doesn't work with Flatfox's API.
- **Canton field** — must be present on each zone for immobilier.ch URLs. The autocomplete fills it automatically from geo.admin.ch data.
