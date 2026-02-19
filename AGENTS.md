# AGENTS.md — Apartment Search

Guide for any AI agent working on this project.

## Overview

Local dashboard (zero-deps, pure Node.js) for tracking apartment listings in French-speaking Switzerland. Multi-source scraping (immobilier.ch, flatfox.ch, homegate.ch, anibis.ch), cross-source deduplication, scoring, and status pipeline tracking.

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
└── package.json
```

## Stack

- **Runtime:** Node.js 18+ (ESM modules, zero npm dependencies)
- **Frontend:** Vanilla JS, no framework, no bundler
- **Backend:** Native HTTP server (`node:http`)
- **Data:** JSON files in `data/profiles/`

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:`, etc.)
- **Branch:** Work directly on `main`
- **Style:** No linter configured, but keep consistency with existing code
- **Language:** Code, comments, and documentation in English. UI labels in French (target audience is French-speaking Switzerland).

## Key Concepts

### Profiles
Each profile is independent: its own zones, budget, sources, and data. Stored in `data/profiles/{slug}/`. Slug format: `[a-z0-9-]+`.

### Deduplication
Two levels:
1. **By ID** — same source, same listing
2. **Cross-source** — composite key: `normalized address + rooms + surface (±5m²) + price (±50 CHF)`. Keeps the listing with the best quality rank.

### Scoring
Each listing gets a 0-100 score based on profile criteria (budget, rooms, surface, distance, etc.). `scoreBreakdown` contains the breakdown.

### Status Pipeline
`À contacter → Visite → Dossier → Relance → Accepté / Refusé / Sans réponse`

### Removed Listings
When a listing hasn't appeared for N scans (`missingScansBeforeRemoved`), it's marked `isRemoved: true`. Shown in the kanban under "Retirées".

## REST API

All data routes take `?profile={slug}`.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/profiles` | List profiles with stats |
| GET | `/api/profile/detail?profile=` | Full profile config |
| POST | `/api/profile/create` | Create a profile |
| POST | `/api/profile/update` | Update a profile |
| POST | `/api/profile/delete` | Delete a profile |
| GET | `/api/state?profile=` | Tracker + latest for a profile |
| POST | `/api/update-status?profile=` | Change listing status/notes |
| POST | `/api/delete-listing?profile=` | Delete a listing |
| POST | `/api/run-scan?profile=` | Trigger a scan |

## Frontend Routes

| Route | Page |
|-------|------|
| `/` | Home — profile management |
| `/{slug}/dashboard` | Per-profile dashboard |

## Common Pitfalls

- **pm2** manages the server. After modifying the server: `pm2 restart apartment-search-web`. Don't kill the process manually.
- **No npm deps** — everything uses native Node.js modules. Don't add dependencies without a good reason.
- **`data/profiles/` is gitignored** — data is local-only. Only code is versioned.
- **The scraper is large** (~2500 lines). It handles 4 sources, each with its own parsing quirks. Modify with care.
- **`ensureProfileStorage()`** auto-creates the profile directory if missing when accessing the dashboard. For profiles created via API, `buildConfigFromPayload()` generates the config.
- **The frontend uses hardcoded maps** (`PROFILE_TITLES`, `PROFILE_ZONES` in `app.js`) as fallback — but the profile switcher loads labels dynamically from `/api/profiles`.
