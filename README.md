# Apartment Search 🏠

Local dashboard for tracking apartment listings in Switzerland. Automatically scrapes listings from immobilier.ch, flatfox.ch, homegate.ch, and anibis.ch, then displays them in a dashboard with status tracking, scoring, and cross-source deduplication.

## Prerequisites

- **Node.js 18+** (no npm dependencies to install)
- **Homegate credentials** (optional, only if you enable homegate.ch as a source) — see `.env.example`

## Getting Started

```bash
git clone <repo-url>
cd apartment-search
npm start
```

Open http://localhost:8787/ in your browser.

## First Run

On first access, the home page shows the profile list (empty initially). Click **"Créer un profil"** to configure:

- **Title** — short profile name (e.g. "Vevey et environs")
- **Zones** — cities/municipalities to watch (slug + label)
- **Budget** — max rent, hard cap, "pearl" threshold
- **Rooms / minimum surface**
- **Workplace address** — for distance calculation
- **Sources** — which sites to enable (immobilier.ch, flatfox.ch, homegate.ch, anibis.ch)

Each profile is independent with its own data and criteria.

## Usage

### Dashboard

Each profile has its own dashboard at `/{profile}/dashboard`:

- **Table view** — sort by score, price, zone
- **Kanban view** — tracking pipeline (À contacter → Visite → Dossier → etc.)
- **Filters** — by priority, pearls, studios
- **Actions** — change status, add notes, delete

### Running a Scan

Two options:

1. **From the dashboard** — click "Lancer un scan"
2. **CLI**:
   ```bash
   npm run scan -- --profile=vevey
   ```

The scan fetches new listings, deduplicates (same listing across multiple sites = 1 entry), computes a score, and updates the tracker.

### Managing Profiles

The home page (`/`) lets you:

- View all profiles with listing count and budget
- Create, edit, or delete profiles
- Navigate to each profile's dashboard

The profile switcher in the dashboard header also allows quick switching.

## Project Structure

```
apartment-search/
├── dashboard/          # Frontend (HTML/CSS/JS, zero framework)
│   ├── home.html       # Home page / profile management
│   ├── index.html      # Per-profile dashboard
│   ├── app.js          # Dashboard logic
│   └── styles.css      # Shared styles
├── scripts/
│   ├── serve-dashboard.mjs   # HTTP server + API
│   └── scrape-immobilier.mjs # Multi-source scraper
├── data/
│   └── profiles/       # One folder per profile (gitignored)
│       └── {profile}/
│           ├── watch-config.json     # Configuration
│           ├── tracker.json          # Tracked listings
│           ├── latest-listings.json  # Latest scan results
│           └── geocode-cache.json    # Geocoding cache
└── package.json
```

## How It Works

1. **Scrape** — fetches listings from configured sources
2. **Deduplication** — by ID (intra-source), then by composite key address+rooms+surface+price (cross-source)
3. **Scoring** — each listing gets a score based on profile criteria
4. **Tracker** — listings are persisted and their status is tracked across scans
5. **Dashboard** — real-time display with filters, sorting, and actions

## Port

Default: `8787`. Configurable via the `PORT` environment variable:

```bash
PORT=3000 npm start
```
