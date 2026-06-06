// Floating listings panel (right) — restyled cards with photo, score, hover actions.

const CAP = 200;
const VIEWED_DEBOUNCE_MS = 2000;

let pendingIds = new Set();
let flushTimer = null;
let onMarkViewedHandler = () => {};
let currentSort = 'recent';
let lastListings = [];
let lastHandlers = null;
let sortBound = false;

export function renderListings(listings, handlers) {
  lastListings = listings;
  lastHandlers = handlers;
  onMarkViewedHandler = handlers.onMarkViewed || (() => {});

  const sortEl = document.getElementById('listings-sort');
  if (sortEl) {
    sortEl.value = currentSort;
    if (!sortBound) {
      sortBound = true;
      sortEl.addEventListener('change', () => {
        currentSort = sortEl.value;
        renderListings(lastListings, lastHandlers);
      });
    }
  }

  const rowsEl = document.getElementById('listings-rows');
  const countEl = document.getElementById('listings-count');
  if (!rowsEl) return;

  const sorted = sortListings(listings, currentSort);
  const visible = sorted.slice(0, CAP);

  rowsEl.replaceChildren();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Aucune annonce ne correspond aux filtres.';
    rowsEl.appendChild(empty);
  } else {
    for (const listing of visible) {
      rowsEl.appendChild(buildRow(listing, handlers));
    }
  }

  if (sorted.length > CAP) {
    const more = document.createElement('div');
    more.className = 'listings-more';
    more.textContent = '+' + (sorted.length - CAP) + ' annonces masquées (affinez les filtres)';
    rowsEl.appendChild(more);
  }

  if (countEl) {
    countEl.replaceChildren();
    const num = document.createElement('b');
    num.textContent = String(listings.length);
    countEl.append(num, document.createTextNode(' annonce' + (listings.length === 1 ? '' : 's')));
  }
}

function sortListings(listings, sortKey) {
  const arr = [...listings];
  if (sortKey === 'recent') {
    arr.sort((a, b) => parseDate(b.firstSeenAt) - parseDate(a.firstSeenAt));
  } else if (sortKey === 'score') {
    arr.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  } else if (sortKey === 'price-asc') {
    arr.sort((a, b) => (a.totalChf ?? Infinity) - (b.totalChf ?? Infinity));
  } else if (sortKey === 'price-desc') {
    arr.sort((a, b) => (b.totalChf ?? -Infinity) - (a.totalChf ?? -Infinity));
  }
  return arr;
}

function parseDate(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function buildRow(listing, handlers) {
  const row = document.createElement('article');
  row.className = 'listing-card';
  if (!listing.viewedAt) row.classList.add('is-unread'); else row.classList.add('is-read');
  row.dataset.id = listing.id;

  const stripe = document.createElement('div');
  stripe.className = 'lc-stripe';
  stripe.style.background = listing.profileColor || '#56d4b8';

  const photo = buildPhoto(listing);

  const body = document.createElement('div');
  body.className = 'lc-body';

  const row1 = document.createElement('div');
  row1.className = 'lc-row1';
  const title = document.createElement('span');
  title.className = 'lc-title';
  title.textContent = listing.title || listing.address || 'Annonce';
  row1.appendChild(title);
  if (listing.score != null) {
    const score = document.createElement('span');
    score.className = 'lc-score';
    score.title = 'Score';
    score.textContent = String(listing.score);
    row1.appendChild(score);
  }

  const row2 = document.createElement('div');
  row2.className = 'lc-row2';
  if (listing.totalChf != null) {
    const price = document.createElement('b');
    price.textContent = 'CHF ' + Number(listing.totalChf).toLocaleString('fr-CH');
    row2.appendChild(price);
  }
  if (listing.rooms != null) {
    appendDot(row2);
    row2.appendChild(textSpan(formatRooms(listing.rooms)));
  }
  if (listing.surfaceM2 != null) {
    appendDot(row2);
    row2.appendChild(textSpan(Math.round(listing.surfaceM2) + ' m²'));
  }

  const row3 = document.createElement('div');
  row3.className = 'lc-row3';
  if (listing.source) {
    const src = document.createElement('span');
    src.className = 'lc-source';
    src.textContent = listing.source;
    row3.appendChild(src);
  }
  if (listing.area) {
    if (row3.childNodes.length) appendDot(row3);
    row3.appendChild(textSpan(listing.area));
  }
  const ago = relativeTime(listing.firstSeenAt);
  if (ago) {
    if (row3.childNodes.length) appendDot(row3);
    row3.appendChild(textSpan(ago));
  }

  body.append(row1, row2, row3);

  // No hover actions — status is changed from the detail panel's segment.

  row.append(stripe, photo, body);
  row.addEventListener('click', () => handlers.onClick && handlers.onClick(listing.id));
  row.addEventListener('mouseenter', () => handlers.onHover && handlers.onHover(listing.id));
  row.addEventListener('mouseleave', () => handlers.onHover && handlers.onHover(null));
  return row;
}

function buildPhoto(listing) {
  const url = pickPhotoUrl(listing);
  if (url) {
    const img = document.createElement('img');
    img.className = 'lc-photo';
    img.loading = 'lazy';
    img.src = url;
    img.alt = '';
    img.addEventListener('error', () => {
      img.replaceWith(placeholderPhoto());
    });
    return img;
  }
  return placeholderPhoto();
}

function placeholderPhoto() {
  const fallback = document.createElement('div');
  fallback.className = 'lc-photo placeholder';
  const i = document.createElement('i');
  i.className = 'fa-regular fa-image';
  fallback.appendChild(i);
  return fallback;
}

function pickPhotoUrl(listing) {
  const candidates = [
    ...(Array.isArray(listing.imageUrls) ? listing.imageUrls : []),
    ...(Array.isArray(listing.imageUrlsLocal) ? listing.imageUrlsLocal : []),
    ...(Array.isArray(listing.imageUrlsRemote) ? listing.imageUrlsRemote : []),
    listing.imageUrl
  ].filter(Boolean);
  return candidates[0] || '';
}

function appendDot(parent) {
  const span = document.createElement('span');
  span.className = 'lc-dot';
  span.textContent = '·';
  parent.appendChild(span);
}

function textSpan(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function formatRooms(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)) + ' p';
}

function relativeTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const days = Math.floor(diff / (24 * 3600 * 1000));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return 'il y a ' + days + ' j';
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

export function setHoveredRow(id) {
  const rows = document.querySelectorAll('.listing-card.is-hovered');
  rows.forEach((r) => r.classList.remove('is-hovered'));
  if (!id) return;
  const row = findRow(id);
  if (row) row.classList.add('is-hovered');
}

export function markRowAsRead(id) {
  const row = findRow(id);
  if (row) {
    row.classList.remove('is-unread');
    row.classList.add('is-read');
  }
}

function findRow(id) {
  const escaped = (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
  return document.querySelector('.listing-card[data-id="' + escaped + '"]');
}

export function setListingsVisible(visible) {
  const el = document.getElementById('listings-panel');
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}
