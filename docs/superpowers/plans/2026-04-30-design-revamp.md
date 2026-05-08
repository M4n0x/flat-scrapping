# Design Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Apartment Ops dashboard around a light shadcn/Geist design system with an emerald accent, and fold in the targeted layout cleanups described in `docs/superpowers/specs/2026-04-30-design-revamp-design.md`.

**Architecture:** Two new vanilla CSS files (`tokens.css` for design tokens, `components.css` for shared component classes) are imported by both HTML pages. The existing `styles.css` shrinks to dashboard-specific layout; `home.css` shrinks to home-specific layout. HTML structure is reshaped for the new topbar/toolbar/KPI patterns. JS files get class-name swaps and modal/dialog rewiring. No new npm dependencies.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework, no bundler), Inter via Google Fonts, plain-div modal overlays (toggled with an `.open` class), Leaflet (already used).

**Verification model:** This codebase has no frontend tests. Each task ends with explicit browser-verification steps using `npm start` (port 8787) and listed acceptance checks. Existing backend tests in `tests/*.test.mjs` must keep passing — run `node --test tests/*.test.mjs` after any task that touches `scripts/`.

**XSS posture:** All listing fields originate from third-party scrapers and must be treated as untrusted. Templates use `escapeHtml` for text injected into innerHTML; URLs (image src / background-image) are applied via DOM properties (`img.src = …`, `el.style.backgroundImage = …`) or `textContent` rather than concatenated into HTML strings. Follow this rule in every Task that touches `app.js` or `home.js`.

**Pre-requisite:** Have at least one profile with listings in `data/profiles/`. If empty, run `npm run scan -- --profile=<slug>` once before starting verification.

---

### Task 1: Foundation — tokens.css + Inter font + link in both HTMLs

**Files:**
- Create: `dashboard/tokens.css`
- Modify: `dashboard/index.html` (head)
- Modify: `dashboard/home.html` (head)

After this task the site will look broken (old CSS variables don't match new ones yet), but the new tokens and font are wired up for subsequent tasks. The next two tasks will replace `styles.css` and `home.css` content. Don't run the dashboard for verification yet — just confirm the files were created.

- [ ] **Step 1: Create `dashboard/tokens.css`**

Create the file with this exact content:

```css
/* Design tokens — shadcn / Geist (light), emerald accent.
   Imported once before component and page CSS. */

:root {
  /* === Color: neutral (zinc) === */
  --bg: #fafafa;
  --surface: #ffffff;
  --surface-2: #fafafa;
  --border: #e4e4e7;
  --border-soft: #f4f4f5;
  --text: #09090b;
  --muted: #71717a;
  --muted-2: #a1a1aa;

  /* === Color: accent (emerald) === */
  --accent: #059669;
  --accent-dark: #065f46;
  --accent-soft: #d1fae5;
  --accent-fg: #ffffff;
  --ring: rgba(5, 150, 105, 0.18);

  /* === Color: semantic === */
  --success: #16a34a;
  --success-soft: #dcfce7;
  --success-dark: #166534;
  --warning: #d97706;
  --warning-soft: #fef3c7;
  --warning-dark: #92400e;
  --danger: #dc2626;
  --danger-soft: #fee2e2;
  --danger-dark: #991b1b;
  --info: #2563eb;
  --info-soft: #dbeafe;
  --info-dark: #1e40af;

  /* === Typography === */
  --font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, monospace;

  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-md: 15px;
  --text-lg: 16px;
  --text-xl: 20px;
  --text-2xl: 24px;
  --text-3xl: 30px;

  --fw-normal: 400;
  --fw-medium: 500;
  --fw-semibold: 600;
  --fw-bold: 700;

  --lh-tight: 1.2;
  --lh-normal: 1.5;
  --lh-loose: 1.7;

  /* === Spacing (4 px base) === */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;
  --sp-12: 48px;

  /* === Radii === */
  --radius-sm: 6px;
  --radius: 8px;
  --radius-lg: 12px;
  --radius-pill: 999px;

  /* === Shadows === */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow: 0 2px 4px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 12px 28px rgba(0, 0, 0, 0.10), 0 4px 8px rgba(0, 0, 0, 0.06);

  /* === Layout === */
  --topbar-h: 52px;
  --content-max: 1320px;
  --gutter: 24px;
}
```

- [ ] **Step 2: Update `dashboard/index.html` head**

Replace the contents of the `<head>` with:

```html
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Apartment Ops — Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer" />
<link rel="stylesheet" href="/dashboard/tokens.css" />
<link rel="stylesheet" href="/dashboard/components.css" />
<link rel="stylesheet" href="/dashboard/styles.css" />
```

(`components.css` does not exist yet — Task 2 will create it. The `<link>` will 404 silently in the browser; that is OK for the duration of this task.)

- [ ] **Step 3: Update `dashboard/home.html` head**

Replace the contents of the `<head>` with:

```html
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Apartment Ops — Profils</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
<link rel="stylesheet" href="/dashboard/tokens.css" />
<link rel="stylesheet" href="/dashboard/components.css" />
<link rel="stylesheet" href="/dashboard/home.css" />
```

(Note: `styles.css` is removed from `home.html` — after Task 8, `home.css` is fully self-sufficient via `tokens.css` + `components.css`.)

- [ ] **Step 4: Verify file presence**

Run:
```bash
ls -1 dashboard/tokens.css
grep -l "tokens.css" dashboard/index.html dashboard/home.html
```
Expected: both `<link>` tags present, file exists.

- [ ] **Step 5: Commit**

```bash
git add dashboard/tokens.css dashboard/index.html dashboard/home.html
git commit -m "feat(design): add tokens.css and switch to Inter font"
```

---

### Task 2: components.css — primitives

**Files:**
- Create: `dashboard/components.css`

This task creates the shared component layer used by both pages. It is created in two tasks: this one for primitives (reset, typography, button, badge, input, card, dialog, checkbox, status pill), and Task 3 for layout-shaped components (topbar, page-header, KPI row, tabs, table, empty).

- [ ] **Step 1: Create `dashboard/components.css` with primitives**

Create the file with this content:

```css
/* Components — shadcn / Geist primitives.
   Depends on tokens.css. */

/* ---------- Reset ---------- */
*,
*::before,
*::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--lh-normal);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
button { font-family: inherit; }
img { max-width: 100%; display: block; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm); }

/* ---------- Typography ---------- */
h1, h2, h3, h4, h5, h6 {
  margin: 0;
  font-family: var(--font-sans);
  font-weight: var(--fw-semibold);
  letter-spacing: -0.02em;
  color: var(--text);
}
h1 { font-size: var(--text-2xl); }
h2 { font-size: var(--text-xl); }
h3 { font-size: var(--text-lg); }
p { margin: 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-dark); text-decoration: underline; }

.muted { color: var(--muted); }
.tnum  { font-feature-settings: "tnum"; }

/* ---------- Button ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  font-size: var(--text-base);
  font-weight: var(--fw-medium);
  line-height: 1;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 120ms, border-color 120ms, color 120ms, box-shadow 120ms;
  white-space: nowrap;
  user-select: none;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }

.btn.primary,
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}
.btn.primary:hover,
.btn-primary:hover { background: var(--accent-dark); border-color: var(--accent-dark); }

.btn.ghost,
.btn-ghost {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}
.btn.ghost:hover,
.btn-ghost:hover { background: var(--surface-2); }

.btn-destructive {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
.btn-destructive:hover { background: var(--danger-dark); border-color: var(--danger-dark); }

.btn-link {
  background: transparent;
  border-color: transparent;
  color: var(--accent);
  padding: 4px 6px;
}
.btn-link:hover { text-decoration: underline; }

.btn-sm { font-size: var(--text-sm); padding: 6px 10px; }
.btn-icon { padding: 6px; }

/* ---------- Input / Search ---------- */
.input,
input.input,
textarea.input,
select.input {
  width: 100%;
  font-family: inherit;
  font-size: var(--text-base);
  line-height: 1.4;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  transition: border-color 120ms, box-shadow 120ms;
}
.input::placeholder { color: var(--muted-2); }
.input:focus,
.input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--ring);
}

.search {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 7px 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: border-color 120ms, box-shadow 120ms;
}
.search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--ring);
}
.search > .search-icon {
  color: var(--muted-2);
  font-size: var(--text-sm);
  flex-shrink: 0;
}
.search > input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  font-family: inherit;
  font-size: var(--text-base);
  color: var(--text);
  min-width: 0;
}
.search > input::placeholder { color: var(--muted-2); }

/* Native <select> styled like a button — used for profile switcher, sort, filter */
.select-trigger,
select.select-trigger {
  appearance: none;
  -webkit-appearance: none;
  font-family: inherit;
  font-size: var(--text-base);
  font-weight: var(--fw-medium);
  line-height: 1;
  padding: 7px 32px 7px 12px;
  background: var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2371717a' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 11px center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms, background-color 120ms;
}
.select-trigger:hover { background-color: var(--surface-2); }
.select-trigger:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--ring);
}

/* ---------- Card ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--sp-5);
}
.card-header { margin-bottom: var(--sp-4); display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-3); }
.card-title { font-size: var(--text-lg); font-weight: var(--fw-semibold); }
.card-body  { font-size: var(--text-base); color: var(--text); }
.card-foot  { margin-top: var(--sp-4); padding-top: var(--sp-3); border-top: 1px solid var(--border-soft); display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); }

/* ---------- Badge ---------- */
.badge {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  background: var(--border-soft);
  color: var(--muted);
  border: 1px solid transparent;
  line-height: 1.4;
  white-space: nowrap;
}
.badge-score   { background: var(--surface-2); color: #3f3f46; border-color: var(--border); font-feature-settings: "tnum"; }
.badge-direct  { background: var(--accent-soft); color: var(--accent-dark); }
.badge-new     { background: var(--info-soft); color: var(--info-dark); }
.badge-removed { background: var(--danger-soft); color: var(--danger-dark); }
.badge-warn    { background: var(--warning-soft); color: var(--warning-dark); }

/* ---------- Status pill (pipeline state) ---------- */
.status-pill {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  white-space: nowrap;
  line-height: 1.5;
}
.status-pill[data-status="contact"]  { background: #fffbeb; color: #92400e; border-color: #fde68a; }
.status-pill[data-status="visite"]   { background: var(--info-soft); color: var(--info-dark); border-color: #bfdbfe; }
.status-pill[data-status="dossier"]  { background: var(--accent-soft); color: var(--accent-dark); border-color: #a7f3d0; }
.status-pill[data-status="relance"]  { background: #f3e8ff; color: #6b21a8; border-color: #e9d5ff; }
.status-pill[data-status="accepte"]  { background: var(--success-soft); color: var(--success-dark); border-color: #bbf7d0; }
.status-pill[data-status="refuse"]   { background: var(--danger-soft); color: var(--danger-dark); border-color: #fecaca; }
.status-pill[data-status="aucune"]   { background: var(--border-soft); color: var(--muted); }

/* ---------- Checkbox / Toggle ---------- */
.checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--text-base);
  color: var(--text);
  cursor: pointer;
  user-select: none;
}
.checkbox input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  cursor: pointer;
  transition: background 120ms, border-color 120ms;
  flex-shrink: 0;
  display: inline-grid;
  place-content: center;
}
.checkbox input[type="checkbox"]:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.checkbox input[type="checkbox"]:checked::after {
  content: '';
  width: 9px;
  height: 5px;
  border: solid #fff;
  border-width: 0 0 2px 2px;
  transform: rotate(-45deg) translate(1px, -1px);
}
.checkbox input[type="checkbox"]:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }

/* ---------- Dialog (modal) ---------- */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(9, 9, 11, 0.55);
  display: none;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
  z-index: 1000;
  animation: dialog-fade 120ms ease-out;
}
.dialog-overlay.open { display: flex; }
.dialog-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  max-width: 640px;
  width: 100%;
  max-height: calc(100vh - 48px);
  overflow: auto;
  position: relative;
  padding: var(--sp-6);
  animation: dialog-pop 140ms ease-out;
}
.dialog-panel.full { max-width: min(1100px, 96vw); padding: 0; background: transparent; border: 0; box-shadow: none; }
.dialog-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-3); margin-bottom: var(--sp-5); }
.dialog-head h2 { font-size: var(--text-xl); }
.dialog-head .dialog-sub { font-size: var(--text-sm); color: var(--muted); margin-top: 2px; }
.dialog-close {
  appearance: none;
  background: transparent;
  border: 0;
  width: 32px; height: 32px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--muted);
  font-size: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.dialog-close:hover { background: var(--border-soft); color: var(--text); }

@keyframes dialog-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes dialog-pop {
  from { transform: scale(0.97); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

/* ---------- Empty state ---------- */
.empty {
  text-align: center;
  padding: var(--sp-12) var(--sp-6);
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  color: var(--muted);
}
.empty .empty-icon { font-size: 28px; margin-bottom: var(--sp-3); }
.empty h3 { color: var(--text); margin-bottom: var(--sp-2); }
.empty p { font-size: var(--text-sm); max-width: 380px; margin: 0 auto var(--sp-5); }

/* ---------- Helpers ---------- */
.hidden { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
```

- [ ] **Step 2: Verify file**

Run:
```bash
wc -l dashboard/components.css
```
Expected: about 280 lines.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components.css
git commit -m "feat(design): add components.css primitives"
```

---

### Task 3: components.css — layout components

**Files:**
- Modify: `dashboard/components.css` (append)

- [ ] **Step 1: Append layout components to `dashboard/components.css`**

Append this content to the end of the file:

```css

/* =====================================================
   Layout components
   ===================================================== */

/* ---------- Topbar (sticky, frosted) ---------- */
.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(255, 255, 255, 0.85);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--border);
  padding: 0 var(--gutter);
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
@supports not (backdrop-filter: blur(1px)) {
  .topbar { background: var(--surface); }
}
.topbar .brand {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-weight: var(--fw-semibold);
  font-size: var(--text-base);
  color: var(--text);
  letter-spacing: -0.01em;
  text-decoration: none;
}
.topbar .brand:hover { color: var(--accent-dark); text-decoration: none; }
.topbar .brand-dot {
  width: 18px; height: 18px;
  border-radius: 5px;
  background: var(--accent);
}
.topbar .grow { flex: 1; }
.topbar .last-scan {
  font-size: var(--text-sm);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}
.topbar .last-scan::before {
  content: '';
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
.topbar .last-scan.running::before {
  background: var(--warning);
  animation: pulse 1.4s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

/* ---------- Page header ---------- */
.page-header {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--sp-6) var(--gutter) var(--sp-3);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--sp-4);
  flex-wrap: wrap;
}
.page-header h1 { font-size: var(--text-2xl); font-weight: var(--fw-semibold); letter-spacing: -0.02em; }
.page-header .meta {
  margin-top: var(--sp-2);
  font-size: var(--text-sm);
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  align-items: center;
}
.page-header .meta .sep { color: var(--border); }
.page-header .header-actions { display: flex; gap: var(--sp-2); align-items: center; flex-shrink: 0; }

/* ---------- KPI row ---------- */
.kpi-row {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 0 var(--gutter) var(--sp-4);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-8);
}
.kpi {
  padding-right: var(--sp-8);
  border-right: 1px solid var(--border);
}
.kpi:last-child { border-right: 0; padding-right: 0; }
.kpi-lbl {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: var(--fw-medium);
}
.kpi-val {
  font-size: var(--text-2xl);
  font-weight: var(--fw-semibold);
  letter-spacing: -0.02em;
  font-feature-settings: "tnum";
  margin-top: 2px;
  color: var(--text);
}
.kpi-val.accent { color: var(--accent); }
.kpi-delta { font-size: var(--text-xs); color: var(--muted); margin-top: 2px; font-feature-settings: "tnum"; }

/* ---------- Tabs (segmented) ---------- */
.tabs {
  display: inline-flex;
  background: var(--border-soft);
  padding: 3px;
  border-radius: var(--radius);
  gap: 2px;
}
.tab {
  appearance: none;
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  padding: 6px 12px;
  border-radius: 5px;
  cursor: pointer;
  color: var(--muted);
  transition: background 120ms, color 120ms, box-shadow 120ms;
}
.tab:hover { color: var(--text); }
.tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }

/* ---------- Toolbar (sits below page-header) ---------- */
.toolbar {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--sp-3) var(--gutter);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  border-bottom: 1px solid var(--border-soft);
  flex-wrap: wrap;
}
.toolbar .search { flex: 1; max-width: 380px; min-width: 180px; }
.toolbar .grow { flex: 1; }

/* ---------- Table ---------- */
.table-wrap {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}
.table thead th {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  font-weight: var(--fw-medium);
  text-align: left;
  padding: 10px 14px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.table tbody td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: middle;
  color: var(--text);
}
.table tbody tr:last-child td { border-bottom: 0; }
.table tbody tr:hover { background: var(--surface-2); cursor: pointer; }
.table .price { font-weight: var(--fw-semibold); font-feature-settings: "tnum"; }
.table .addr-main { font-weight: var(--fw-medium); }
.table .addr-sub  { font-size: var(--text-sm); color: var(--muted); margin-top: 1px; }
.table .pri-bar {
  width: 3px;
  height: 32px;
  border-radius: 2px;
  background: #cbd5e1;
}
.table .pri-bar[data-priority="A"]  { background: var(--accent); }
.table .pri-bar[data-priority="A-"] { background: #84cc16; }
.table .pri-bar[data-priority="B"]  { background: #cbd5e1; }
.table .thumb {
  width: 56px; height: 42px;
  border-radius: var(--radius-sm);
  background: var(--border-soft) center / cover no-repeat;
  flex-shrink: 0;
}
.table .row-actions {
  color: var(--muted-2);
  font-size: var(--text-lg);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 0;
}
.table .row-actions:hover { background: var(--border-soft); color: var(--text); }
```

- [ ] **Step 2: Verify file size**

Run:
```bash
wc -l dashboard/components.css
```
Expected: about 510 lines.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components.css
git commit -m "feat(design): add layout components (topbar, kpi, tabs, table)"
```

---

### Task 4: Rewrite dashboard HTML structure

**Files:**
- Modify: `dashboard/index.html`

After this task the page will reference IDs/classes that the JS doesn't yet read; some interactivity will break until Task 6. That is expected.

- [ ] **Step 1: Replace the entire `dashboard/index.html` body**

Replace everything between `<body>` and `</body>` with:

```html
    <!-- Sticky top bar -->
    <header class="topbar">
      <a href="/" class="brand"><span class="brand-dot"></span>Apartment Ops</a>
      <select id="profile-switcher" class="select-trigger" aria-label="Changer de profil"></select>
      <span class="grow"></span>
      <span id="last-scan" class="last-scan hidden">Dernier scan…</span>
      <button id="refresh" class="btn btn-ghost btn-sm" type="button">Rafraîchir</button>
      <button id="scan" class="btn btn-primary btn-sm" type="button">Scanner</button>
    </header>

    <!-- Page header -->
    <section class="page-header">
      <div>
        <h1 id="page-title">Chargement du profil…</h1>
        <p id="page-meta" class="meta"></p>
      </div>
    </section>

    <!-- KPIs -->
    <section class="kpi-row" id="kpis"></section>

    <!-- Toolbar: tabs + search + filter + sort -->
    <section class="toolbar">
      <div class="tabs" role="tablist" aria-label="Changer de vue">
        <button id="tab-table"  class="tab active" type="button" role="tab" data-view="table"  aria-selected="true">Table</button>
        <button id="tab-kanban" class="tab"        type="button" role="tab" data-view="kanban" aria-selected="false">Kanban</button>
      </div>
      <label class="search">
        <span class="search-icon" aria-hidden="true">🔍</span>
        <input id="search-box" type="search" placeholder="Recherche par adresse, type, zone…" />
      </label>
      <span class="grow"></span>
      <select id="priority-filter" class="select-trigger" aria-label="Filtre">
        <option value="all">Toutes</option>
        <option value="top">Priorité A</option>
        <option value="direct">Régie directe</option>
      </select>
      <select id="sort-by" class="select-trigger" aria-label="Trier">
        <option value="score">Trier · Score</option>
        <option value="price">Trier · Loyer</option>
        <option value="area">Trier · Zone</option>
        <option value="date">Trier · Date</option>
      </select>
    </section>

    <!-- Main content -->
    <main class="page-content">
      <div id="panel-table" class="view-panel active">
        <div class="table-wrap">
          <table class="table listings-table">
            <thead>
              <tr>
                <th style="width:8px"></th>
                <th style="width:70px"></th>
                <th>Bien</th>
                <th style="width:110px">Loyer</th>
                <th style="width:110px">Trajet</th>
                <th style="width:80px">Score</th>
                <th style="width:140px">Statut</th>
                <th style="width:32px"></th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
        <section class="mobile-board" id="mobile-rows"></section>
      </div>

      <div id="panel-kanban" class="view-panel">
        <div id="kanban-board" class="kanban-board"></div>
      </div>
    </main>

    <!-- Scan output dialog (was an inline <pre>) -->
    <div id="scan-dialog" class="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="scan-dialog-title">
      <div class="dialog-panel">
        <div class="dialog-head">
          <div>
            <h2 id="scan-dialog-title">Scan en cours</h2>
            <p class="dialog-sub">Sortie du scraper</p>
          </div>
          <button class="dialog-close" type="button" data-close-dialog aria-label="Fermer">✕</button>
        </div>
        <pre id="scan-output" class="scan-output"></pre>
      </div>
    </div>

    <script type="module" src="/dashboard/app.js"></script>
```

(The `<div class="bg-layer">` and the `<main class="app-shell">` wrapper are removed — the new layout uses the page edges directly.)

- [ ] **Step 2: Smoke-check the markup**

Run:
```bash
grep -c 'id="profile-switcher"\|id="rows"\|id="kanban-board"\|id="scan-output"\|id="search-box"\|id="priority-filter"\|id="sort-by"\|id="refresh"\|id="scan"' dashboard/index.html
```
Expected: 9 (one for each of the IDs `app.js` already references).

- [ ] **Step 3: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(design): rewrite dashboard markup for new topbar/toolbar/table"
```

---

### Task 5: Rewrite styles.css for dashboard layout

**Files:**
- Replace: `dashboard/styles.css` (entire contents)

`styles.css` is now dashboard-only layout: `.page-content` wrapper, mobile board, kanban view, scan-output styling, and the lightbox overlay (rebuilt on the new tokens — JS still drives the same class names).

- [ ] **Step 1: Overwrite `dashboard/styles.css`**

Replace the entire file with:

```css
/* Dashboard layout (per-profile). Depends on tokens.css and components.css. */

.page-content {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--sp-3) var(--gutter) var(--sp-12);
}

.view-panel { display: none; }
.view-panel.active { display: block; }

/* ---------- Listings table cell helpers ---------- */
.listings-table .listing-thumb-cell { padding-left: 14px; }
.listings-table .listing-bien-cell  { line-height: 1.4; }
.listings-table .badge { margin-left: 6px; }

/* ---------- Mobile board (compact card list) ---------- */
.mobile-board {
  display: none;
  flex-direction: column;
  gap: var(--sp-3);
  margin-top: var(--sp-4);
}
.mobile-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--sp-4);
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--sp-3);
  align-items: flex-start;
}
.mobile-card .pri-bar {
  width: 3px;
  align-self: stretch;
  border-radius: 2px;
  background: #cbd5e1;
}
.mobile-card .pri-bar[data-priority="A"]  { background: var(--accent); }
.mobile-card .pri-bar[data-priority="A-"] { background: #84cc16; }
.mobile-card .price { font-weight: var(--fw-semibold); font-feature-settings: "tnum"; }
.mobile-card .meta  { font-size: var(--text-sm); color: var(--muted); margin-top: 2px; }
.mobile-card .actions { display: flex; flex-direction: column; gap: var(--sp-2); align-items: flex-end; }

@media (max-width: 720px) {
  .listings-table { display: none; }
  .table-wrap { border: 0; background: transparent; }
  .mobile-board { display: flex; }
}

/* ---------- Kanban ---------- */
.kanban-board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--sp-3);
  margin-top: var(--sp-4);
}
.kanban-col {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-height: 200px;
}
.kanban-col-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--sp-1) var(--sp-2) var(--sp-2);
}
.kanban-col-title {
  font-size: var(--text-sm);
  font-weight: var(--fw-semibold);
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.kanban-col-count {
  font-size: var(--text-xs);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  font-feature-settings: "tnum";
  font-weight: var(--fw-medium);
}
.kanban-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--sp-3);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color 120ms, transform 120ms, box-shadow 120ms;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.kanban-card:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.kanban-card .price { font-weight: var(--fw-semibold); font-feature-settings: "tnum"; }
.kanban-card .meta  { color: var(--muted); font-size: var(--text-xs); }
.kanban-card .actions { display: flex; gap: var(--sp-2); justify-content: flex-end; }

/* ---------- Scan output (inside dialog) ---------- */
.scan-output {
  background: #0a0a0c;
  color: #e4e4e7;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding: var(--sp-4);
  border-radius: var(--radius);
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  margin: 0;
}

/* ---------- Lightbox (image gallery dialog, full variant) ---------- */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background: rgba(9, 9, 11, 0.92);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: var(--sp-6);
}
.lightbox-overlay.open { display: flex; }
.lightbox-img {
  max-width: 100%;
  max-height: calc(100vh - 160px);
  border-radius: var(--radius);
  background: #18181b;
}
.lightbox-close,
.lightbox-nav {
  position: absolute;
  appearance: none;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  width: 40px; height: 40px;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 120ms, border-color 120ms;
  font-size: 18px;
}
.lightbox-close:hover,
.lightbox-nav:hover { background: rgba(255, 255, 255, 0.16); border-color: rgba(255, 255, 255, 0.32); }
.lightbox-close { top: 16px; right: 16px; }
.lightbox-prev  { left: 16px;  top: 50%; transform: translateY(-50%); }
.lightbox-next  { right: 16px; top: 50%; transform: translateY(-50%); }
.lightbox-counter {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: var(--text-sm);
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  font-feature-settings: "tnum";
}
.lightbox-strip {
  position: absolute;
  bottom: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: var(--sp-2);
  max-width: 90vw;
  overflow-x: auto;
  padding-bottom: 4px;
}
.lightbox-strip img {
  width: 56px; height: 42px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 120ms, transform 120ms;
}
.lightbox-strip img:hover { opacity: 0.85; }
.lightbox-strip img.active { opacity: 1; transform: translateY(-2px); border: 2px solid var(--accent); }

@media (max-width: 720px) {
  .topbar { padding: 0 var(--sp-4); gap: var(--sp-2); }
  .topbar .brand { font-size: var(--text-sm); }
  .page-header { padding-left: var(--sp-4); padding-right: var(--sp-4); }
  .toolbar { padding-left: var(--sp-4); padding-right: var(--sp-4); }
  .kpi-row { gap: var(--sp-5); padding-left: var(--sp-4); padding-right: var(--sp-4); }
  .kpi { padding-right: var(--sp-5); }
}
```

- [ ] **Step 2: Confirm size**

Run:
```bash
wc -l dashboard/styles.css
```
Expected: about 200 lines (was 1235).

- [ ] **Step 3: Start the server for a sanity check**

```bash
npm start
```

Visit `http://localhost:8787/{slug}/dashboard` (replace `{slug}` with an existing profile, e.g. `vevey`). Expected at this stage: topbar visible, page header below, KPI row blank (still rendered into old DOM), table area shows old broken rows or nothing (JS still uses old IDs for rows). This intermediate state is intentional pending Task 6.

Stop the server (Ctrl-C) before continuing.

- [ ] **Step 4: Commit**

```bash
git add dashboard/styles.css
git commit -m "feat(design): rewrite dashboard styles.css on new tokens"
```

---

### Task 6: Update app.js for new IDs/classes + scan-output dialog

**Files:**
- Modify: `dashboard/app.js`

The HTML rewrite removed `.hero h1`, `.eyebrow`, `#zones`, `#sub`; tab IDs are preserved. KPI cards previously rendered into `#cards` now render into `#kpis`; scan output now lives inside a dialog. This task adapts JS accordingly. Preserve all existing rendering logic for rows, kanban cards, filters, sort, search.

**XSS rule:** templates below use `escapeHtml(text)` for any string variable interpolated into innerHTML. URLs are never injected via string concatenation — they are assigned via DOM properties (`.src`, `.style.backgroundImage`).

- [ ] **Step 1: Update top-of-file selectors in `dashboard/app.js`**

Open `dashboard/app.js`. Replace lines 1–18 with:

```js
const kpisEl = document.getElementById('kpis');
const rowsEl = document.getElementById('rows');
const mobileRowsEl = document.getElementById('mobile-rows');
const kanbanEl = document.getElementById('kanban-board');
const refreshBtn = document.getElementById('refresh');
const scanBtn = document.getElementById('scan');
const scanOut = document.getElementById('scan-output');
const scanDialog = document.getElementById('scan-dialog');
const lastScanEl = document.getElementById('last-scan');
const filterEl = document.getElementById('priority-filter');
const sortEl = document.getElementById('sort-by');
const searchEl = document.getElementById('search-box');
const tabTableEl = document.getElementById('tab-table');
const tabKanbanEl = document.getElementById('tab-kanban');
const panelTableEl = document.getElementById('panel-table');
const panelKanbanEl = document.getElementById('panel-kanban');
const pageTitleEl = document.getElementById('page-title');
const pageMetaEl = document.getElementById('page-meta');
const profileSwitcherEl = document.getElementById('profile-switcher');
```

- [ ] **Step 2: Replace `heroTitleEl` / `zonesEl` / `subEl` references**

Search the rest of `app.js` for `heroTitleEl`, `zonesEl`, `subEl`. Replace as follows:

| Old | New |
|---|---|
| `heroTitleEl.textContent = X` | `pageTitleEl.textContent = X` |
| `zonesEl.textContent = X`     | `pageMetaEl.textContent = X` |
| `subEl.textContent = X`       | (delete the line — page meta replaces it) |

After this step, `heroTitleEl`, `zonesEl`, and `subEl` should no longer appear in `app.js`.

Run:
```bash
grep -n 'heroTitleEl\|zonesEl\|subEl' dashboard/app.js
```
Expected: no matches.

- [ ] **Step 3: Update KPI rendering**

Find the function that renders into `cardsEl` (search `cardsEl.innerHTML` and `cardsEl.appendChild`). Replace it (or the inline rendering) with this helper, and rename every `cardsEl` reference in the file to `kpisEl`:

```js
function renderKpis(stats) {
  // stats = [{ label: 'Total', value: 42, accent: false, delta: '+3 cette semaine' }, ...]
  kpisEl.innerHTML = '';
  for (const s of stats) {
    const div = document.createElement('div');
    div.className = 'kpi';
    const lbl = document.createElement('div');
    lbl.className = 'kpi-lbl';
    lbl.textContent = s.label;
    const val = document.createElement('div');
    val.className = s.accent ? 'kpi-val accent' : 'kpi-val';
    val.textContent = String(s.value);
    div.append(lbl, val);
    if (s.delta) {
      const delta = document.createElement('div');
      delta.className = 'kpi-delta';
      delta.textContent = s.delta;
      div.append(delta);
    }
    kpisEl.append(div);
  }
}
```

Then call `renderKpis([...])` wherever the old code built `<article class="card">` items. Map the existing metrics so each card becomes one entry: at minimum `{ label, value }`; mark Priorité A with `accent: true`. Keep whatever delta/sub-string the old code put in the card's `<p>` element.

Run:
```bash
grep -n 'cardsEl' dashboard/app.js
```
Expected: no matches.

- [ ] **Step 4: Wire scan-output dialog**

Find the existing scan trigger logic — search for `scan-output`, `scanOut.classList.remove('hidden')`, or `scanBtn.addEventListener`. Replace the body of the scan handler with this exact code (preserve any earlier business logic that streams output into `scanOut`):

```js
scanBtn.addEventListener('click', async () => {
  scanOut.textContent = '';
  scanDialog.classList.add('open');
  lastScanEl.classList.remove('hidden');
  lastScanEl.classList.add('running');
  lastScanEl.textContent = 'Scan en cours…';

  try {
    const res = await fetch(apiUrl('/api/run-scan'), { method: 'POST' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      scanOut.textContent += decoder.decode(value, { stream: true });
      scanOut.scrollTop = scanOut.scrollHeight;
    }
    lastScanEl.classList.remove('running');
    lastScanEl.textContent = 'Dernier scan à l\'instant';
    await refresh();
  } catch (err) {
    scanOut.textContent += `\n[error] ${err.message}`;
    lastScanEl.classList.remove('running');
    lastScanEl.textContent = 'Scan échoué';
  }
});
```

If the existing helpers `apiUrl(path)` and `refresh()` are present with compatible signatures, leave them. If the scan API was previously called via a different helper, port that helper's behavior into the body above.

- [ ] **Step 5: Wire dialog close + focus management**

Add this near the other event listeners (anywhere after `scanDialog` is defined). The helper centralizes overlay-click, Escape-to-close, focus-on-open (first focusable element inside), and focus-restore on close — covering the spec's accessibility requirement for the dialog component.

```js
function openDialog(dialog) {
  if (!dialog) return;
  dialog.dataset.prevFocus = '';
  const prev = document.activeElement;
  if (prev && prev !== document.body) {
    dialog.__prevFocus = prev;
  }
  dialog.classList.add('open');
  const first = dialog.querySelector(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  first?.focus();
}
function closeDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('open');
  const prev = dialog.__prevFocus;
  if (prev && typeof prev.focus === 'function') prev.focus();
  dialog.__prevFocus = null;
}
function setupDialogClose(dialog) {
  if (!dialog) return;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest?.('[data-close-dialog]')) {
      closeDialog(dialog);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.classList.contains('open')) {
      closeDialog(dialog);
    }
  });
}
setupDialogClose(scanDialog);
```

In Step 4 above, change `scanDialog.classList.add('open')` to `openDialog(scanDialog)`. (Closing happens via `setupDialogClose`'s click/Escape handlers.)

- [ ] **Step 6: Update tab switching to use the new aria pattern**

Find the existing tab handler (the lines that toggle `view-tab.active` / `view-panel.active`). Replace it with:

```js
function setActiveView(view) {
  const tabs = [tabTableEl, tabKanbanEl];
  const panels = [panelTableEl, panelKanbanEl];
  tabs.forEach((t) => {
    if (!t) return;
    const isActive = t.dataset.view === view;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', String(isActive));
  });
  panels.forEach((p) => {
    if (!p) return;
    p.classList.toggle('active', p.id === `panel-${view}`);
  });
}
tabTableEl?.addEventListener('click', () => setActiveView('table'));
tabKanbanEl?.addEventListener('click', () => setActiveView('kanban'));
```

(If a default-tab call already exists, leave it. Otherwise add `setActiveView('table');` at the end of init.)

- [ ] **Step 7: Verify dashboard works**

Run:
```bash
npm start
```

Visit `http://localhost:8787/{slug}/dashboard`. Verify:

- Topbar shows brand + profile switcher + Refresh/Scan buttons.
- Page title and zones meta load from the profile.
- KPI row populates with at least 1 KPI.
- Table view shows rows. Switching to Kanban shows columns.
- Search, filter, sort all still work.
- Clicking Scan opens the dialog with streaming output; the topbar's "Dernier scan" indicator updates.
- Clicking the dialog's ✕ or pressing Escape closes it.

Stop the server.

- [ ] **Step 8: Run backend tests as a regression check**

```bash
node --test tests/listing-filters.test.mjs tests/map-listings.test.mjs tests/map-utils.test.mjs
```
Expected: all tests pass (no backend code changed).

- [ ] **Step 9: Commit**

```bash
git add dashboard/app.js
git commit -m "feat(design): wire dashboard JS to new markup and scan dialog"
```

---

### Task 7: Restyle table rows + kanban cards (markup-side)

**Files:**
- Modify: `dashboard/app.js`

The CSS for the new table and kanban shapes is already in `components.css` and `styles.css`. This task updates the row/card-renderer functions in `app.js` to emit the new HTML those styles expect.

**XSS rule reminder:** all interpolated text uses `escapeHtml`; thumbnail URLs are assigned via `.style.backgroundImage` after `innerHTML` is set, never concatenated into the HTML string.

- [ ] **Step 1: Add helper functions if missing**

Add at the top of `app.js` (after the `const … = document.getElementById(...)` block):

```js
const STATUS_LABELS = {
  contact: 'À contacter',
  visite: 'Visite',
  dossier: 'Dossier',
  relance: 'Relance',
  accepte: 'Accepté',
  refuse: 'Refusé',
  aucune: '—'
};
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('fr-CH').replace(/ |\s/g, "'");
}
```

If these names already exist in `app.js`, skip the redefinition (they conflict otherwise) — just confirm they have the same behavior.

- [ ] **Step 2: Update table row renderer**

Locate the function that builds a table row (search `rowsEl.appendChild` or the function that returns a `<tr>`). Replace its row-building body with:

```js
function buildTableRow(listing) {
  const tr = document.createElement('tr');
  tr.dataset.id = listing.id;

  const priority = listing.priority || 'B';
  const score = listing.score ?? '—';
  const status = listing.status || 'aucune';
  const statusLabel = STATUS_LABELS[status] || '—';
  const directBadge  = listing.isDirect ? '<span class="badge badge-direct">Régie directe</span>' : '';
  const newBadge     = listing.isNew ? '<span class="badge badge-new">Nouveau</span>' : '';
  const removedBadge = listing.isRemoved ? '<span class="badge badge-removed">Retirée</span>' : '';

  tr.innerHTML = `
    <td><div class="pri-bar" data-priority="${escapeHtml(priority)}"></div></td>
    <td><div class="thumb" data-thumb></div></td>
    <td>
      <div class="addr-main">${escapeHtml(listing.address || listing.title || '—')}</div>
      <div class="addr-sub">${escapeHtml(listing.areaLabel || '')} · ${escapeHtml(String(listing.rooms ?? '?'))} pièces · ${escapeHtml(String(listing.surfaceM2 ?? '?'))} m² ${directBadge}${newBadge}${removedBadge}</div>
    </td>
    <td class="price">CHF ${escapeHtml(formatPrice(listing.totalChf))}</td>
    <td>${listing.travelMinutes ? `${escapeHtml(String(listing.travelMinutes))} min` : '—'}</td>
    <td><span class="badge badge-score">${escapeHtml(String(score))}</span></td>
    <td><span class="status-pill" data-status="${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></td>
    <td><button class="row-actions" data-action-menu type="button" aria-label="Actions">⋯</button></td>
  `;

  // Apply thumb URL via DOM property to avoid HTML injection through the URL
  const thumbUrl = (listing.imageUrlsRemote || [])[0];
  if (thumbUrl) {
    const thumbEl = tr.querySelector('[data-thumb]');
    thumbEl.style.backgroundImage = `url(${JSON.stringify(thumbUrl)})`;
  }

  return tr;
}
```

(Note `JSON.stringify(thumbUrl)` produces a quoted string with internal quotes/backslashes escaped — safe to drop into a CSS `url(...)` value when applied via `.style`.)

The exact field accessors (`listing.totalChf`, `listing.travelMinutes`, etc.) must match whatever the existing code uses elsewhere. If a field is named differently in this codebase, keep the existing accessor and substitute it into the template.

- [ ] **Step 3: Update kanban card renderer**

Locate the function that builds a kanban card (search `kanban-card`). Replace the card markup with:

```js
function buildKanbanCard(listing) {
  const el = document.createElement('div');
  el.className = 'kanban-card';
  el.dataset.id = listing.id;
  el.innerHTML = `
    <div class="price">CHF ${escapeHtml(formatPrice(listing.totalChf))}</div>
    <div class="meta">${escapeHtml(listing.address || listing.title || '—')} · ${escapeHtml(String(listing.rooms ?? '?'))}p · ${escapeHtml(String(listing.surfaceM2 ?? '?'))}m²</div>
    <div class="meta">Score ${escapeHtml(String(listing.score ?? '—'))} · ${listing.travelMinutes ? `${escapeHtml(String(listing.travelMinutes))} min` : '—'}</div>
  `;
  return el;
}
```

Update the kanban column header builder to emit the new shape:

```js
function buildKanbanColumn(label, count) {
  const col = document.createElement('section');
  col.className = 'kanban-col';
  col.innerHTML = `
    <header class="kanban-col-head">
      <div class="kanban-col-title">${escapeHtml(label)}</div>
      <span class="kanban-col-count">${escapeHtml(String(count))}</span>
    </header>
  `;
  return col;
}
```

Use these in place of the existing column/card builders.

- [ ] **Step 4: Verify the dashboard end-to-end**

Run `npm start` and visit `http://localhost:8787/{slug}/dashboard`. Verify:

- Table rows show priority bar, thumbnail (or empty thumb placeholder), address, sub-line with rooms/surface and any badges (direct/new/removed), price, travel time, score badge, status pill, ⋯ actions button.
- Hover over a row: subtle background change.
- Kanban view: columns labeled per pipeline state, each card shows price, address, meta. Hover lifts the card.
- No browser console errors during render.

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app.js
git commit -m "feat(design): emit shadcn-shaped rows and kanban cards"
```

---

### Task 8: Rewrite home HTML structure

**Files:**
- Modify: `dashboard/home.html`

Replace the existing `home-hero` + custom tabs + inline `create-section` form with the new `topbar` / `page-header` / `tabs` pattern, and move the profile create/edit form into a `.dialog`.

- [ ] **Step 1: Replace the entire body of `dashboard/home.html`**

Replace everything between `<body>` and `</body>` with:

```html
    <!-- Sticky top bar -->
    <header class="topbar">
      <a href="/" class="brand"><span class="brand-dot"></span>Apartment Ops</a>
      <span class="grow"></span>
      <button id="scan-all-btn" class="btn btn-ghost btn-sm" type="button">Tout scanner</button>
    </header>

    <!-- Page header -->
    <section class="page-header">
      <div>
        <h1>Mes profils de recherche</h1>
        <p class="meta">Chaque profil surveille des zones et des critères différents.</p>
      </div>
      <div class="header-actions">
        <button id="open-create-dialog" class="btn btn-primary" type="button">Créer un profil</button>
      </div>
    </section>

    <!-- Toolbar with view tabs -->
    <section class="toolbar">
      <div class="tabs" role="tablist" aria-label="Navigation accueil">
        <button id="home-tab-profiles" class="tab active" type="button" role="tab" data-home-view="profiles" aria-selected="true">Mes profils</button>
        <button id="home-tab-map"      class="tab"        type="button" role="tab" data-home-view="map"      aria-selected="false">Carte globale</button>
      </div>
      <span class="grow"></span>
      <span id="scan-all-progress" class="last-scan hidden"></span>
    </section>

    <!-- Profiles tab -->
    <section id="home-panel-profiles" class="home-panel active">
      <div class="page-content">
        <section id="profiles-grid" class="profiles-grid">
          <p class="loading-msg muted">Chargement…</p>
        </section>
      </div>
    </section>

    <!-- Carte globale tab -->
    <section id="home-panel-map" class="home-panel">
      <div class="global-map-shell">
        <aside class="global-map-controls card">
          <div class="map-control-head">
            <h2>Carte globale</h2>
            <button id="map-refresh" class="btn btn-ghost btn-sm" type="button">Rafraîchir</button>
          </div>
          <div class="tabs map-mode-toggle" role="group" aria-label="Détail des pins">
            <button id="map-mode-points"  class="tab active" type="button" data-map-mode="points"  aria-selected="true">Points</button>
            <button id="map-mode-details" class="tab"        type="button" data-map-mode="details" aria-selected="false">Détails</button>
          </div>
          <div id="map-profile-filters" class="map-profile-filters"></div>
          <p id="map-status" class="map-status muted">Chargement…</p>
        </aside>
        <section class="global-map-panel">
          <div id="global-map" class="global-map" aria-label="Carte des annonces"></div>
          <div id="map-empty" class="empty hidden"></div>
        </section>
      </div>
    </section>

    <!-- Profile create / edit dialog -->
    <div id="profile-dialog" class="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="form-title">
      <div class="dialog-panel">
        <div class="dialog-head">
          <div>
            <h2 id="form-title">Nouveau profil</h2>
            <p class="dialog-sub">Définit les zones, le budget et les sources à scanner.</p>
          </div>
          <button class="dialog-close" type="button" data-close-dialog aria-label="Fermer">✕</button>
        </div>

        <form id="profile-form" class="profile-form" autocomplete="off">
          <input type="hidden" id="edit-slug" value="" />

          <label class="form-field">
            <span class="form-label">Titre court</span>
            <input class="input" type="text" id="f-title" placeholder="Ex: Vevey et environs" required />
          </label>

          <fieldset class="form-fieldset">
            <legend>Zones de recherche</legend>
            <div id="zones-list" class="zones-list"></div>
            <div class="zone-add-row">
              <div class="zone-autocomplete-wrap">
                <input class="input" type="text" id="zone-search" placeholder="Rechercher une commune…" autocomplete="off" />
                <ul id="zone-suggestions" class="zone-suggestions hidden"></ul>
              </div>
            </div>
          </fieldset>

          <div class="form-grid-2">
            <label class="form-field">
              <span class="form-label">Loyer min (CHF)</span>
              <input class="input" type="number" id="f-min-rent" value="0" min="0" step="50" />
            </label>
            <label class="form-field">
              <span class="form-label">Loyer max (CHF)</span>
              <input class="input" type="number" id="f-max-rent" value="1400" min="0" step="50" />
            </label>
          </div>

          <div class="form-grid-3">
            <label class="form-field">
              <span class="form-label">Pièces min</span>
              <input class="input" type="number" id="f-min-rooms" value="2" min="1" max="10" step="0.5" />
            </label>
            <label class="form-field">
              <span class="form-label">Surface min (m²)</span>
              <input class="input" type="number" id="f-min-surface" value="0" min="0" step="5" />
            </label>
            <label class="form-field">
              <span class="form-label">Ancienneté max (jours)</span>
              <input class="input" type="number" id="f-max-age" value="30" min="1" max="365" step="1" />
            </label>
          </div>

          <label class="checkbox">
            <input type="checkbox" id="f-allow-missing-surface" />
            <span>Inclure les annonces sans surface renseignée</span>
          </label>

          <label class="form-field">
            <span class="form-label">Adresse de travail (pour calcul distance)</span>
            <div class="zone-autocomplete-wrap">
              <input class="input" type="text" id="f-workplace" placeholder="Rechercher une adresse…" autocomplete="off" />
              <ul id="workplace-suggestions" class="zone-suggestions hidden"></ul>
            </div>
          </label>

          <fieldset class="form-fieldset">
            <legend>Sources</legend>
            <div class="form-checkbox-grid">
              <label class="checkbox"><input type="checkbox" id="s-immobilier" checked /> <span>immobilier.ch</span></label>
              <label class="checkbox"><input type="checkbox" id="s-flatfox" checked /> <span>flatfox.ch</span></label>
              <label class="checkbox"><input type="checkbox" id="s-naef" checked /> <span>naef.ch (direct régie)</span></label>
              <label class="checkbox"><input type="checkbox" id="s-bernard" checked /> <span>bernard-nicod.ch (direct régie)</span></label>
              <label class="checkbox"><input type="checkbox" id="s-rp-listings" checked /> <span>Retraites Populaires (locations directes)</span></label>
              <label class="checkbox"><input type="checkbox" id="s-rp-projects" checked /> <span>Retraites Populaires (projets neufs / off-market)</span></label>
              <label class="checkbox"><input type="checkbox" id="s-anibis" /> <span>anibis.ch</span></label>
            </div>
          </fieldset>

          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="form-cancel" data-close-dialog>Annuler</button>
            <button type="submit" class="btn btn-primary" id="form-submit">Créer le profil</button>
          </div>
        </form>
      </div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
    <script type="module" src="/dashboard/home.js"></script>
```

- [ ] **Step 2: Smoke check**

Run:
```bash
grep -c 'id="profile-form"\|id="profiles-grid"\|id="home-tab-profiles"\|id="home-tab-map"\|id="global-map"\|id="map-profile-filters"\|id="zone-search"\|id="zone-suggestions"\|id="workplace-suggestions"\|id="f-title"' dashboard/home.html
```
Expected: 10 (one per ID `home.js` references).

- [ ] **Step 3: Commit**

```bash
git add dashboard/home.html
git commit -m "feat(design): rewrite home markup with topbar, tabs and dialog form"
```

---

### Task 9: Rewrite home.css for home page layout

**Files:**
- Replace: `dashboard/home.css` (entire contents)

`home.css` becomes home-only layout — profile cards grid, form layout helpers used inside the dialog, global-map shell.

- [ ] **Step 1: Overwrite `dashboard/home.css`**

Replace the entire file with:

```css
/* Home page layout. Depends on tokens.css and components.css. */

.page-content {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--sp-3) var(--gutter) var(--sp-12);
}

.home-panel { display: none; }
.home-panel.active { display: block; }

/* ---------- Profiles grid ---------- */
.profiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--sp-4);
  margin-top: var(--sp-2);
}
.profile-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  transition: border-color 120ms, transform 120ms, box-shadow 120ms;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
}
.profile-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}
.profile-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--sp-3);
}
.profile-card h3 {
  font-size: var(--text-lg);
  font-weight: var(--fw-semibold);
}
.profile-card-meta {
  font-size: var(--text-sm);
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.profile-card-zones {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.profile-card-zones .badge { background: var(--accent-soft); color: var(--accent-dark); }
.profile-card-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-soft);
}
.profile-card-stat .lbl {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.profile-card-stat .val {
  font-size: var(--text-lg);
  font-weight: var(--fw-semibold);
  font-feature-settings: "tnum";
  margin-top: 2px;
}
.profile-card-actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: flex-end;
  margin-top: auto;
}
.loading-msg { padding: var(--sp-6) var(--sp-4); }

/* ---------- Form (inside dialog) ---------- */
.profile-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.form-field { display: flex; flex-direction: column; gap: var(--sp-2); }
.form-label {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--text);
}
.form-fieldset {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.form-fieldset > legend {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--text);
  padding: 0 var(--sp-2);
}
.form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.form-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-3); }
.form-checkbox-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-soft);
}
@media (max-width: 640px) {
  .form-grid-2, .form-grid-3, .form-checkbox-grid { grid-template-columns: 1fr; }
}

/* ---------- Zone chips list (inside fieldset) ---------- */
.zones-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.zone-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--text-sm);
  padding: 4px 10px;
  background: var(--accent-soft);
  color: var(--accent-dark);
  border-radius: var(--radius-pill);
}
.zone-chip button {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--accent-dark);
  cursor: pointer;
  font-size: var(--text-base);
  padding: 0;
  line-height: 1;
}
.zone-chip button:hover { color: var(--danger); }

/* ---------- Autocomplete (zones / workplace) ---------- */
.zone-autocomplete-wrap { position: relative; }
.zone-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 240px;
  overflow: auto;
  z-index: 5;
}
.zone-suggestions li {
  padding: 8px 10px;
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sp-2);
}
.zone-suggestions li:hover,
.zone-suggestions li[aria-selected="true"] { background: var(--accent-soft); color: var(--accent-dark); }
.zone-suggestions li .canton {
  font-size: var(--text-xs);
  color: var(--muted);
  background: var(--border-soft);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

/* ---------- Global map ---------- */
.global-map-shell {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: var(--sp-4);
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--sp-3) var(--gutter) var(--sp-8);
  height: calc(100vh - var(--topbar-h) - 200px);
  min-height: 480px;
}
.global-map-controls {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  overflow: auto;
  padding: var(--sp-4);
}
.map-control-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.map-mode-toggle { width: 100%; }
.map-mode-toggle .tab { flex: 1; }
.map-profile-filters {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.map-status { font-size: var(--text-sm); }
.global-map-panel {
  position: relative;
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border);
}
.global-map {
  width: 100%;
  height: 100%;
  background: var(--surface-2);
}
.map-empty {
  position: absolute;
  inset: var(--sp-4);
  background: var(--surface);
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 880px) {
  .global-map-shell { grid-template-columns: 1fr; height: auto; }
  .global-map-panel { height: 60vh; }
}

/* ---------- Map filter checkbox row ---------- */
.map-filter-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.map-filter-row:hover { background: var(--surface-2); }
.map-filter-row .swatch {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.map-filter-row .count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--muted);
  font-feature-settings: "tnum";
}
```

- [ ] **Step 2: Confirm size**

Run:
```bash
wc -l dashboard/home.css
```
Expected: about 240 lines (was 819).

- [ ] **Step 3: Commit**

```bash
git add dashboard/home.css
git commit -m "feat(design): rewrite home.css on new tokens"
```

---

### Task 10: Update home.js for new IDs/classes + form dialog

**Files:**
- Modify: `dashboard/home.js`

The home page rewrite replaced the inline `create-section` toggle with a dialog overlay (`#profile-dialog`); profile cards use a new shape; tab class names changed from `home-tab` to `tab`. This task adapts JS.

**XSS rule reminder:** every interpolated string uses `escapeHtml`; every URL is set via DOM property (no concatenation into HTML strings); the swatch color is sanitized through a `cssColor()` helper that allows only hex/rgb/named-color forms.

- [ ] **Step 1: Replace `home-tab` class operations**

Search inside `dashboard/home.js`:

```bash
grep -n "'home-tab'" dashboard/home.js
```

For each match, change `'home-tab'` → `'tab'` and `'home-tab active'` → `'tab active'`. The IDs `home-tab-profiles` and `home-tab-map` stay as is (they reference DOM elements by ID, not by class name). Verify:

```bash
grep -n "'home-tab " dashboard/home.js
```
Expected: no matches.

- [ ] **Step 2: Add helper functions if missing**

Add at the top of `home.js` (after the existing `const … = document.getElementById(...)` block):

```js
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('fr-CH').replace(/ |\s/g, "'");
}
function formatRelative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const hr = ms / 3.6e6;
  if (hr < 1) return `${Math.round(ms / 6e4)} min`;
  if (hr < 24) return `${Math.round(hr)}h`;
  return `${Math.round(hr / 24)}j`;
}
function cssColor(s) {
  // Accept #RGB, #RRGGBB, rgb(...) / rgba(...), or simple named colors. Fall back to muted color.
  return /^#[0-9a-f]{3,8}$|^rgba?\([\d.,\s%]+\)$|^[a-z]+$/i.test(String(s || '').trim())
    ? String(s).trim()
    : 'var(--muted)';
}
```

If any of these helpers already exist in `home.js`, leave the existing version and skip the duplicate.

- [ ] **Step 3: Wire the create/edit dialog**

Replace the existing `create-section` show/hide logic. Find every reference to `create-section` (typically a `<section>` previously toggled with `.hidden`). Wherever the old code did `createSection.classList.remove('hidden')`, switch to `openProfileDialog(...)`; wherever it did `.classList.add('hidden')`, switch to `closeProfileDialog()`.

Add this block near the top of the file (after element queries). The `openDialog` / `closeDialog` / `setupDialogClose` helpers are the same shape as in Task 6's app.js — copy them into `home.js` (this codebase has no shared module to import from) and call them here:

```js
const profileDialog = document.getElementById('profile-dialog');
const openCreateBtn = document.getElementById('open-create-dialog');
const formTitleEl = document.getElementById('form-title');
const formSubmitEl = document.getElementById('form-submit');

function openDialog(dialog) {
  if (!dialog) return;
  const prev = document.activeElement;
  if (prev && prev !== document.body) dialog.__prevFocus = prev;
  dialog.classList.add('open');
  const first = dialog.querySelector(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  first?.focus();
}
function closeDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('open');
  const prev = dialog.__prevFocus;
  if (prev && typeof prev.focus === 'function') prev.focus();
  dialog.__prevFocus = null;
}
function setupDialogClose(dialog) {
  if (!dialog) return;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest?.('[data-close-dialog]')) closeDialog(dialog);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.classList.contains('open')) closeDialog(dialog);
  });
}
setupDialogClose(profileDialog);

function openProfileDialog({ mode, profile } = { mode: 'create' }) {
  if (mode === 'edit' && profile) {
    formTitleEl.textContent = `Modifier · ${profile.label || profile.slug}`;
    formSubmitEl.textContent = 'Enregistrer';
    fillFormFromProfile(profile);
  } else {
    formTitleEl.textContent = 'Nouveau profil';
    formSubmitEl.textContent = 'Créer le profil';
    resetForm();
  }
  openDialog(profileDialog);
}

function closeProfileDialog() {
  closeDialog(profileDialog);
}

openCreateBtn?.addEventListener('click', () => openProfileDialog({ mode: 'create' }));
```

`fillFormFromProfile(profile)` and `resetForm()` correspond to existing inline logic in the old code. Either keep their existing implementations under those names, or rename inline blocks accordingly. After form submit success, call `closeProfileDialog()` instead of toggling `.hidden` on the section.

- [ ] **Step 4: Update profile card renderer**

Locate the function (or inline block) that builds a profile card (search `profiles-grid`, `profile-card`). Replace its body with:

```js
function buildProfileCard(profile) {
  const a = document.createElement('a');
  a.className = 'profile-card';
  a.href = `/${encodeURIComponent(profile.slug)}/dashboard`;

  const zonesArr = profile.areas || [];
  const zonesHtml = zonesArr.slice(0, 3)
    .map((z) => `<span class="badge badge-direct">${escapeHtml((z && z.label) || z)}</span>`)
    .join('');
  const moreZones = zonesArr.length > 3
    ? `<span class="badge">+${escapeHtml(String(zonesArr.length - 3))}</span>`
    : '';

  const lastScan = profile.lastScanAt
    ? `Scan il y a ${escapeHtml(formatRelative(profile.lastScanAt))}`
    : 'Jamais scanné';

  a.innerHTML = `
    <div class="profile-card-head">
      <h3>${escapeHtml(profile.label || profile.slug)}</h3>
      <button class="row-actions" type="button" data-edit aria-label="Modifier le profil">⋯</button>
    </div>
    <div class="profile-card-zones">${zonesHtml}${moreZones}</div>
    <div class="profile-card-meta">
      <span>CHF ${escapeHtml(formatPrice(profile.minRent || 0))} – ${escapeHtml(formatPrice(profile.maxRent || 0))}</span>
      <span>·</span>
      <span>${escapeHtml(String(profile.minRooms ?? '—'))} pièces min</span>
    </div>
    <div class="profile-card-stats">
      <div class="profile-card-stat"><div class="lbl">Total</div><div class="val">${escapeHtml(String(profile.listingCount ?? 0))}</div></div>
      <div class="profile-card-stat"><div class="lbl">Priorité A</div><div class="val">${escapeHtml(String(profile.priorityACount ?? 0))}</div></div>
      <div class="profile-card-stat"><div class="lbl">Direct</div><div class="val">${escapeHtml(String(profile.directCount ?? 0))}</div></div>
    </div>
    <div class="profile-card-meta"><span>${lastScan}</span></div>
  `;

  a.querySelector('[data-edit]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openProfileDialog({ mode: 'edit', profile });
  });
  return a;
}
```

If the existing `/api/profiles` payload omits `priorityACount`, `directCount`, or `lastScanAt`, the templates above safely degrade to `0` / "Jamais scanné". This revamp does not require new API fields.

- [ ] **Step 5: Empty state when no profiles**

Find the empty-state branch in the existing `loadProfiles` (or equivalent) flow. Replace the empty rendering with:

```js
if (!profiles.length) {
  profilesGridEl.innerHTML = `
    <div class="empty" style="grid-column: 1 / -1;">
      <div class="empty-icon">🏠</div>
      <h3>Aucun profil pour le moment</h3>
      <p>Créez un profil pour commencer à suivre les annonces dans vos zones.</p>
      <button class="btn btn-primary" type="button" id="empty-create-btn">Créer un profil</button>
    </div>
  `;
  document.getElementById('empty-create-btn')?.addEventListener('click', () => openProfileDialog({ mode: 'create' }));
  return;
}
```

(`profilesGridEl` should be whatever local variable references `#profiles-grid`.)

- [ ] **Step 6: Restyle map filter rows**

Find the function that renders entries inside `#map-profile-filters`. Replace each row's construction with DOM building (so the color string can never inject HTML/CSS):

```js
function buildMapFilterRow(slug, label, color, count) {
  const row = document.createElement('label');
  row.className = 'checkbox map-filter-row';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.profileFilter = slug;
  cb.checked = true;

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = cssColor(color);

  const name = document.createElement('span');
  name.className = 'profile-name';
  name.textContent = label;

  const countEl = document.createElement('span');
  countEl.className = 'count';
  countEl.textContent = String(count);

  row.append(cb, swatch, name, countEl);
  return row;
}
```

Use the same slug/label/color/count values the existing renderer already produces.

- [ ] **Step 7: Verify home page**

Run:
```bash
npm start
```

Visit `http://localhost:8787/`. Verify:

- Topbar shows brand + "Tout scanner" button.
- Page header with title and "Créer un profil" button on the right.
- Tab strip "Mes profils / Carte globale" works.
- Profile cards render with zones chips, budget, rooms, and three stats. Hover lifts the card.
- Clicking "Créer un profil" opens the dialog. Clicking ✕, the backdrop, Escape, or "Annuler" closes it. Submitting saves and closes.
- Clicking the ⋯ button on a profile card opens the edit dialog with pre-filled values.
- "Carte globale" tab: sidebar with controls + map fills the rest. Mode toggle and profile filters work.

Stop the server.

- [ ] **Step 8: Commit**

```bash
git add dashboard/home.js
git commit -m "feat(design): wire home JS to dialog form and new profile cards"
```

---

### Task 11: Lightbox dialog refinements + final cleanup pass

**Files:**
- Modify: `dashboard/app.js` (lightbox helper, if needed)
- Modify: `dashboard/home.js` (if it owns its own lightbox copy)
- Optional: Remove dead CSS / classes from HTML / JS

The lightbox CSS lives in `styles.css` from Task 5. This task verifies the JS still drives it correctly and removes any stale class references that the rewrite missed.

- [ ] **Step 1: Verify lightbox class names**

Run:
```bash
grep -n "lightbox" dashboard/app.js dashboard/home.js
```

Confirm every reference uses one of: `lightbox-overlay`, `lightbox-img`, `lightbox-close`, `lightbox-prev`, `lightbox-next`, `lightbox-counter`, `lightbox-strip`. These match the CSS in `styles.css`. If any reference uses an older class (`.lightbox-modal`, `.lb-*`, etc.), update it.

- [ ] **Step 2: Make sure the lightbox JS uses the `open` class**

The CSS toggles visibility via `.lightbox-overlay.open`. Search:

```bash
grep -n "lightbox-overlay" dashboard/app.js dashboard/home.js
```

Confirm show/hide uses `classList.add('open')` / `classList.remove('open')`. If older code used `style.display = 'flex'` or a different class, update it. Also confirm the `<img>` `src` is set via `imgEl.src = url` (DOM property), not concatenated into innerHTML.

- [ ] **Step 3: Verify in browser**

Run `npm start`. Open the dashboard, click a thumbnail in the table or a kanban card image → the lightbox opens; arrow keys / prev/next buttons cycle images; Escape closes; thumbnail strip highlights the active image. Repeat from the home page if it surfaces a lightbox anywhere.

Stop the server.

- [ ] **Step 4: Hunt for stale CSS refs**

Run:
```bash
grep -rn -E "\.bg-layer|\.app-shell|\.eyebrow|class=\"hero|home-hero|class=\"home-tab|class=\"cards|control-bar|view-tabs-wrap|section-head|profile-switcher\"" dashboard/
```

Each match in HTML/JS files should be cross-referenced:
- If the match is the only reference to that class and it isn't styled by `tokens.css` / `components.css` / `styles.css` / `home.css`, remove the now-dead class from the HTML/JS.
- If the match is in the new HTML by accident, change it to the new equivalent.

- [ ] **Step 5: Final cross-page smoke test**

```bash
npm start
```

Walk through every flow:

- Home `/` Profils tab: list, card hover, edit dialog, create dialog, delete (if exposed via menu), empty state.
- Home `/` Carte globale tab: map renders, profile filters toggle, mode toggle (Points / Détails) switches.
- Dashboard `/{slug}/dashboard`: KPIs, table, search, filter, sort, kanban, scan dialog, lightbox.
- Browser console: no unhandled errors during any flow.

Stop the server.

- [ ] **Step 6: Run backend tests one last time**

```bash
node --test tests/listing-filters.test.mjs tests/map-listings.test.mjs tests/map-utils.test.mjs
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A dashboard/
git commit -m "feat(design): final cleanup, lightbox polish, dead-class purge"
```

---

## Self-review (engineer)

After all tasks are complete:

- [ ] Open the design spec (`docs/superpowers/specs/2026-04-30-design-revamp-design.md`) and read each "Layout cleanups" row. For each, confirm the dashboard or home page now matches that row's "Proposed" column.
- [ ] Confirm `git diff main -- dashboard/` shows: 2 new files (`tokens.css`, `components.css`), 4 rewritten files (`styles.css`, `home.css`, `index.html`, `home.html`), 2 modified JS files (`app.js`, `home.js`), 1 untouched file (`map-utils.js`).
- [ ] Confirm there are no remaining references to the old token palette (`--bg: #08131a`, `--primary: #56d4b8`, etc.) in any dashboard file: `grep -rn "08131a\|56d4b8\|0f1f29" dashboard/` should return zero matches.
- [ ] Confirm all 11 commits land on the working branch with messages prefixed `feat(design):`.
