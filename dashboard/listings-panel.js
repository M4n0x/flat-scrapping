const CAP = 200;
const VIEWED_DEBOUNCE_MS = 2000;
const VIEW_DWELL_MS = 1000;

let pendingIds = new Set();
let flushTimer = null;
let onMarkViewedHandler = () => {};
let listingMap = new Map();
let observer = null;
let viewedDwellTimers = new Map();

export function renderListings(listings, handlers) {
  onMarkViewedHandler = handlers.onMarkViewed || (() => {});
  const rowsEl = document.getElementById('listings-rows');
  const countEl = document.getElementById('listings-count');

  rowsEl.replaceChildren();
  listingMap = new Map();

  const visible = listings.slice(0, CAP);
  for (const listing of visible) {
    listingMap.set(listing.id, listing);
    rowsEl.appendChild(buildRow(listing, handlers));
  }

  if (listings.length > CAP) {
    const more = document.createElement('div');
    more.className = 'listings-more';
    more.textContent = '+' + (listings.length - CAP) + ' annonces masquées (affinez les filtres)';
    rowsEl.appendChild(more);
  }

  countEl.textContent = listings.length + ' annonce' + (listings.length === 1 ? '' : 's');

  attachViewObserver(rowsEl);
}

function buildRow(listing, handlers) {
  const row = document.createElement('article');
  row.className = 'listing-row';
  if (!listing.viewedAt) row.classList.add('is-unread');
  row.dataset.id = listing.id;
  row.style.setProperty('--profile-color', listing.profileColor || '#56d4b8');

  const accent = document.createElement('div');
  accent.className = 'row-accent';

  const thumb = document.createElement('div');
  thumb.className = 'row-thumb';
  if (listing.imageUrls && listing.imageUrls[0]) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = listing.imageUrls[0];
    img.alt = '';
    thumb.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'row-body';

  const title = document.createElement('strong');
  title.textContent = listing.title || listing.address || 'Annonce';

  const meta = document.createElement('div');
  meta.className = 'row-meta';
  const metaParts = [];
  if (listing.totalChf) metaParts.push('CHF ' + Number(listing.totalChf).toLocaleString('fr-CH'));
  if (listing.rooms) metaParts.push(listing.rooms + ' p');
  if (listing.surfaceM2) metaParts.push(listing.surfaceM2 + ' m²');
  meta.textContent = metaParts.join(' · ');

  const sub = document.createElement('div');
  sub.className = 'row-meta-sub';
  const subParts = [];
  if (listing.area) subParts.push(listing.area);
  if (listing.source) subParts.push(listing.source);
  sub.textContent = subParts.join(' · ');

  body.append(title, meta, sub);

  const side = document.createElement('div');
  side.className = 'row-side';
  if (listing.score != null) {
    const score = document.createElement('span');
    score.className = 'score-pill';
    score.textContent = String(listing.score);
    side.appendChild(score);
  }

  row.append(accent, thumb, body, side);
  row.addEventListener('click', () => handlers.onClick && handlers.onClick(listing.id));
  row.addEventListener('mouseenter', () => handlers.onHover && handlers.onHover(listing.id));
  return row;
}

function attachViewObserver(rowsEl) {
  if (observer) observer.disconnect();
  for (const t of viewedDwellTimers.values()) clearTimeout(t);
  viewedDwellTimers = new Map();

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.dataset.id;
      if (!id) continue;
      if (entry.isIntersecting) {
        const listing = listingMap.get(id);
        if (!listing || listing.viewedAt) continue;
        const timer = setTimeout(() => queueViewed(id), VIEW_DWELL_MS);
        viewedDwellTimers.set(id, timer);
      } else {
        const t = viewedDwellTimers.get(id);
        if (t) { clearTimeout(t); viewedDwellTimers.delete(id); }
      }
    }
  }, { root: rowsEl, threshold: 0.4 });

  for (const row of rowsEl.querySelectorAll('.listing-row')) observer.observe(row);
}

export function queueViewed(id) {
  if (!id) return;
  pendingIds.add(id);
  if (!flushTimer) {
    flushTimer = setTimeout(flushViewed, VIEWED_DEBOUNCE_MS);
  }
}

function flushViewed() {
  flushTimer = null;
  if (!pendingIds.size) return;
  const ids = [...pendingIds];
  pendingIds = new Set();
  onMarkViewedHandler(ids);
}

export function highlightRow(id) {
  const row = findRow(id);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('is-flash');
  setTimeout(() => row.classList.remove('is-flash'), 1200);
}

export function markRowAsRead(id) {
  const row = findRow(id);
  if (row) row.classList.remove('is-unread');
}

function findRow(id) {
  const escaped = (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
  return document.querySelector('.listing-row[data-id="' + escaped + '"]');
}
