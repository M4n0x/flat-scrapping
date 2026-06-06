# Design Revamp — shadcn / Geist (light, emerald)

**Date:** 2026-04-30
**Status:** Draft — pending user review

## Goals

Revamp the visual design of the apartment-search dashboard around a single, coherent design system. The result should feel **clear, simple, and modern**, while keeping the app's zero-dependency architecture (vanilla HTML/CSS/JS, no bundler, no framework).

## Non-goals

- Mobile-first redesign. The dashboard stays desktop-primary; existing responsive behavior is preserved but not extended.
- Dark mode. Deferred — light only for now.
- Backend / API / scraping logic changes.
- Restructuring navigation (no left sidebar, no multi-page rework). Layout cleanups stay within each existing screen.
- Adding a CSS framework, build step, or npm dependency.

## Design system

**Base:** shadcn / Geist visual language, expressed as vanilla CSS.

| Decision | Value |
|---|---|
| Theme | Light only |
| Neutral palette | Tailwind `zinc` family (`#fafafa`, `#f4f4f5`, `#e4e4e7`, `#71717a`, `#18181b`, `#09090b`) |
| Accent | Emerald — primary `#059669`, dark `#065f46`, soft `#d1fae5` |
| Body font | Inter (Google Fonts, weights 400 / 500 / 600 / 700) |
| Numeric font feature | `font-feature-settings: "tnum"` on prices, scores, KPIs |
| Default radius | 8 px (`--radius`); 6 px small, 12 px large |
| Default border | 1 px `#e4e4e7`; soft variant `#f4f4f5` |
| Shadow language | Minimal — focus rings + 1 px borders, occasional subtle elevation |
| Density | Compact-but-breathing: 14 px base, 32 px section gutters, 12 px row padding |

### Token catalog

To be defined as CSS custom properties in `tokens.css`:

**Color** — `--bg`, `--surface`, `--surface-2`, `--border`, `--border-soft`, `--text`, `--muted`, `--muted-2`, `--accent`, `--accent-soft`, `--accent-dark`, `--ring`, plus semantic `--success`, `--warning`, `--danger`, `--info` (and `*-soft` / `*-dark` variants where used).

**Typography** — `--text-xs` (11), `--text-sm` (12), `--text-base` (14), `--text-md` (15), `--text-lg` (16), `--text-xl` (20), `--text-2xl` (24); weights `--fw-normal` (400), `--fw-medium` (500), `--fw-semibold` (600), `--fw-bold` (700); base line-height 1.5.

**Spacing** — 4 px base scale: `--sp-1` (4), `--sp-2` (8), `--sp-3` (12), `--sp-4` (16), `--sp-5` (20), `--sp-6` (24), `--sp-8` (32), `--sp-10` (40), `--sp-12` (48).

**Radii** — `--radius-sm` (6), `--radius` (8), `--radius-lg` (12), `--radius-pill` (999).

### Components

The following classes will be defined in `components.css` and consumed by both pages:

- **Button** — `.btn` base; variants `.btn-primary` (emerald fill), `.btn-ghost` (white + border), `.btn-destructive` (red), `.btn-link`; size `.btn-sm`.
- **Input / Search** — `.input`, `.search` (icon + input compound); focus = emerald ring.
- **Select / Dropdown trigger** — `.select-trigger` (looks like a ghost button with chevron). Options use a custom-styled `<select>` for now; full popover dropdown is out of scope.
- **Badge** — `.badge`; modifiers `.badge-score`, `.badge-direct` (emerald-soft), `.badge-new` (blue-soft), `.badge-removed` (red-soft).
- **Status pill** — `.status-pill`; modifiers per pipeline state (À contacter, Visite, Dossier, Relance, Accepté, Refusé, Sans réponse).
- **Card** — `.card` (white surface, 1 px border, `--radius-lg`).
- **KPI** — `.kpi-row`, `.kpi` with `.kpi-lbl`, `.kpi-val`, `.kpi-delta` (no card chrome — separator is a right-border).
- **Tabs** — `.tabs` container with pill-style segmented control, `.tab` items.
- **Table** — `.table` with shadcn-style header (`#fafafa` bg, uppercase 11 px label) and roomy rows; row hover; clickable rows.
- **Dialog** — `.dialog` overlay (semi-transparent black backdrop) + `.dialog-panel` (white card, max-width, padding 24, close button top-right). Used for: image lightbox, profile create/edit form, scan output viewer.
- **Topbar** — `.topbar` sticky frosted bar (translucent white + backdrop-blur), holds brand mark, profile switcher, last-scan indicator, primary actions.
- **Page header** — `.page-header` with `h1` (22 px, weight 600, tight letter-spacing) + `.meta` row (zones + budget + rooms summary).
- **Empty state** — `.empty` centered illustration + headline + body + action.
- **Checkbox / Toggle** — `.checkbox` (square, 16 px, emerald check) and `.toggle` (switch); used in profile create/edit (Sources) and the global map filter list.

## Layout cleanups (option B from brainstorm)

### Per-profile dashboard (`/{slug}/dashboard`)

| Section | Today | Proposed |
|---|---|---|
| Header | `.hero` with eyebrow "Apartment Ops" + h1 + zones + sub + actions, ~140 px tall | Sticky `.topbar` (44 px) with brand + profile switcher + last-scan + Refresh + Scan, then a `.page-header` with title + meta line |
| Stats | 4–5 stats `.cards` with bordered cards | Inline `.kpi-row` (no card chrome) — 5 KPIs separated by vertical dividers |
| Filter / sort / search | `.control-bar` row (3 native selects) | Merged into `.toolbar` |
| View tabs | Separate `.view-tabs-wrap` row (Table / Kanban) | Merged into `.toolbar` as a segmented control |
| Toolbar order | n/a | view-tabs ‹‹ search ‹‹ (spacer) ‹‹ Filtres ‹‹ Trier |
| Table | Plain table | `.card` wrapper, thumbnail column, priority bar, status pill, hover state, clickable rows |
| Kanban | Existing columns | Restyled column header (label + count badge) + restyled cards (same density as today, new tokens) |
| Scan output | Inline `<pre>` block above content | Becomes a `.dialog` (modal) opened from the topbar; non-blocking running indicator stays on the topbar (the dot next to "Dernier scan…") |

### Home (`/`)

The home page already has two view tabs: **Mes profils** (default) and **Carte globale** (cross-profile map overview). Both are restyled.

| Section | Today | Proposed |
|---|---|---|
| Top bar | Custom header | Same `.topbar` component (no profile switcher when on `/`) |
| Hero | Existing hero | Single `.page-header` ("Mes profils" + subtitle), with the "Créer un profil" `.btn-primary` aligned right |
| View tabs | Existing `.home-tab` row | Same segmented `.tabs` component as the dashboard, placed in the same toolbar slot |
| Profile list (tab 1) | Cards in a grid | Same grid (responsive 1–3 cols), restyled `.card` items: title, zones summary chips, budget range, listing count, last-scan delta, action menu (Edit / Delete) |
| Empty state (tab 1) | n/a | New `.empty` block when there are no profiles, with primary CTA |
| Carte globale (tab 2) | Side panel of controls (`.global-map-controls`) + map canvas | Restyled with new tokens: controls panel becomes a 320 px `.card` sidebar; profile-filter checkboxes use the new toggle/checkbox style; mode toggle (Points / Détails) uses the segmented `.tabs` control; map area fills remaining width |

### Profile create / edit (currently a modal on home)

- Replace existing modal with `.dialog` component.
- Form layout: vertical groups (Title; Zones autocomplete; Budget min/max in a 2-col grid; Rooms / surface in a 2-col grid; Workplace; Sources as a checklist of toggles).
- Submit button uses `.btn-primary`; cancel uses `.btn-ghost`.

### Image lightbox

- Replace existing modal with `.dialog` (full-bleed variant): semi-transparent backdrop, large image centered, prev/next arrows, close ×, image counter ("3 / 12") and source URL/footer below.

## File structure

Replace the contents of the existing CSS files. No new HTML files. JS files are not changed by this revamp except for class-name swaps and any DOM tweaks needed by the layout cleanups above.

```
dashboard/
├── tokens.css        # NEW — CSS custom properties (theme)
├── components.css    # NEW — shared component classes
├── styles.css        # MODIFIED — dashboard page layout only (was global)
├── home.css          # MODIFIED — home page layout only
├── index.html        # MODIFIED — link tokens.css + components.css; structural tweaks for new topbar/toolbar/kpis
├── home.html         # MODIFIED — link tokens.css + components.css; structural tweaks for new topbar/header/grid
├── app.js            # MODIFIED — class-name swaps; replace inline scan-output `<pre>` with a dialog open/close
├── home.js           # MODIFIED — class-name swaps; replace modal with new dialog markup
└── map-utils.js      # UNCHANGED
```

`tokens.css` and `components.css` are imported by both `index.html` and `home.html` via `<link>` tags (in that order, before the page-specific stylesheet). No `@import` (avoids a request waterfall).

## Implementation notes

- **Inter** is loaded from Google Fonts via the existing `<link>` pattern in `index.html` / `home.html`. Existing Manrope + Fraunces declarations are removed. No fallback fonts beyond `system-ui, sans-serif`.
- **Backdrop-blur** on the topbar uses `backdrop-filter: blur(12px)` with `-webkit-backdrop-filter` fallback. Solid background fallback (`background: #ffffff`) when blur is unsupported.
- **No JS for component behavior** beyond what already exists. Tabs, dropdowns, dialogs continue to use the existing JS — only the markup and styling change.
- **Accessibility:** focus rings (`--ring`) on every interactive element; keyboard navigation for the new tabs (arrow keys); `aria-current` on active tab; `role="dialog"` + `aria-modal` + focus trap on the dialog component.
- **No regression in features.** All existing functionality is preserved: filters, sorting, search, status updates, notes, deletion, scan trigger, profile switcher, image gallery, lightbox.

## Out-of-scope follow-ups

These are noted to keep the current revamp focused; they are *not* part of this work:

- Dark mode toggle.
- Mobile-first redesign (sub-768 px polish pass).
- Replacing native `<select>` with a custom popover dropdown.
- Replacing the kanban view drag library (none currently — kanban is read-only with action menus).
- Refactoring the >2500-line scraper or backend.

## Open questions

None at time of writing. Anything that comes up during the user's review of this spec will be folded in before the implementation plan is generated.
