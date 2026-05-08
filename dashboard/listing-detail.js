// Floating listing detail panel — opens on pin/row click, replaces Leaflet popup.

import { openLightbox } from '/dashboard/lightbox.js';

const STATUS_LABELS = {
  sorting: 'À trier',
  pursuing: 'À poursuivre',
  archived: 'Archivé'
};

let actionHandler = () => {};
let lastListing = null;

export function initDetailPanel({ onAction } = {}) {
  actionHandler = typeof onAction === 'function' ? onAction : () => {};
}

export function openDetailPanel(listing) {
  if (!listing) return;
  lastListing = listing;
  const panel = document.getElementById('detail-panel');
  if (!panel) return;
  panel.replaceChildren();
  panel.appendChild(buildDetail(listing));
  panel.classList.remove('hidden');
}

export function closeDetailPanel() {
  const panel = document.getElementById('detail-panel');
  if (!panel) return;
  panel.classList.add('hidden');
  panel.replaceChildren();
  lastListing = null;
}

export function isDetailFor(id) {
  return lastListing && lastListing.id === id;
}

function buildDetail(listing) {
  const fragment = document.createDocumentFragment();

  // Header
  const head = document.createElement('div');
  head.className = 'dp-head';

  const stripe = document.createElement('span');
  stripe.className = 'dp-stripe';
  stripe.style.background = listing.profileColor || '#56d4b8';

  const headText = document.createElement('div');
  headText.className = 'dp-head-text';

  const titleText = listing.title || listing.address || 'Annonce';
  let title;
  if (listing.url) {
    title = document.createElement('a');
    title.className = 'dp-title dp-title-link';
    title.href = listing.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = titleText;
    const linkIcon = document.createElement('i');
    linkIcon.className = 'fa-solid fa-arrow-up-right-from-square';
    title.append(' ', linkIcon);
    title.title = "Ouvrir l'annonce";
  } else {
    title = document.createElement('div');
    title.className = 'dp-title';
    title.textContent = titleText;
  }

  const sub = document.createElement('div');
  sub.className = 'dp-sub';
  const subParts = [];
  if (listing.area) subParts.push(listing.area);
  if (listing.source) subParts.push(listing.source);
  sub.textContent = subParts.join(' · ');
  headText.append(title, sub);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.title = 'Fermer';
  closeBtn.setAttribute('aria-label', 'Fermer');
  const closeIcon = document.createElement('i');
  closeIcon.className = 'fa-solid fa-xmark';
  closeBtn.appendChild(closeIcon);
  closeBtn.addEventListener('click', closeDetailPanel);

  head.append(stripe, headText, closeBtn);
  fragment.appendChild(head);

  // Photo
  fragment.appendChild(buildPhoto(listing));

  // Stats grid
  const stats = document.createElement('div');
  stats.className = 'dp-stats';
  stats.appendChild(statCell('Prix', listing.totalChf != null
    ? 'CHF ' + Number(listing.totalChf).toLocaleString('fr-CH')
    : '—'));
  stats.appendChild(statCell('Surface', listing.surfaceM2 != null
    ? Math.round(listing.surfaceM2) + ' m²'
    : '—'));
  stats.appendChild(statCell('Pièces', listing.rooms != null
    ? formatRooms(listing.rooms)
    : '—'));
  stats.appendChild(statCell('Score', listing.score != null
    ? String(listing.score)
    : '—'));
  fragment.appendChild(stats);

  // Meta rows
  const meta = document.createElement('div');
  meta.className = 'dp-meta';

  const statusRow = document.createElement('div');
  statusRow.className = 'dp-meta-row';
  const statusLabel = document.createElement('span');
  statusLabel.className = 'micro-label';
  statusLabel.textContent = 'Statut';
  const statusBadge = document.createElement('span');
  statusBadge.className = 'dp-badge';
  statusBadge.textContent = STATUS_LABELS[listing.status] || listing.status || '—';
  statusRow.append(statusLabel, statusBadge);
  meta.appendChild(statusRow);

  if (listing.profileTitle || listing.profileSlug) {
    const profileRow = document.createElement('div');
    profileRow.className = 'dp-meta-row';
    const profileLabel = document.createElement('span');
    profileLabel.className = 'micro-label';
    profileLabel.textContent = 'Profil';
    const profileBadge = document.createElement('span');
    profileBadge.className = 'dp-badge';
    profileBadge.style.borderColor = listing.profileColor || '';
    profileBadge.style.color = listing.profileColor ? darken(listing.profileColor) : '';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = listing.profileColor || '#56d4b8';
    profileBadge.append(dot, document.createTextNode(listing.profileTitle || listing.profileSlug));
    profileRow.append(profileLabel, profileBadge);
    meta.appendChild(profileRow);
  }

  if (listing.address) {
    const addressRow = document.createElement('div');
    addressRow.className = 'dp-meta-row';
    const al = document.createElement('span');
    al.className = 'micro-label';
    al.textContent = 'Adresse';
    const av = document.createElement('span');
    av.className = 'dp-badge';
    av.textContent = listing.address;
    addressRow.append(al, av);
    meta.appendChild(addressRow);
  }

  const dateInfo = pickListingDate(listing);
  if (dateInfo) {
    const row = document.createElement('div');
    row.className = 'dp-meta-row';
    const label = document.createElement('span');
    label.className = 'micro-label';
    label.textContent = dateInfo.label;
    const value = document.createElement('span');
    value.className = 'dp-badge';
    value.textContent = dateInfo.text;
    row.append(label, value);
    meta.appendChild(row);
  }

  fragment.appendChild(meta);

  // Status segment (À trier / À poursuivre / Archivé)
  const statusSeg = document.createElement('div');
  statusSeg.className = 'dp-status-seg';
  const statusOptions = [
    { key: 'sorting',  action: 'sort',    label: 'À trier' },
    { key: 'pursuing', action: 'pursue',  label: 'À poursuivre' },
    { key: 'archived', action: 'archive', label: 'Archivé' }
  ];
  for (const opt of statusOptions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dp-status-opt' + (listing.status === opt.key ? ' is-on' : '');
    btn.textContent = opt.label;
    btn.disabled = listing.status === opt.key;
    btn.addEventListener('click', () => actionHandler(opt.action, listing));
    statusSeg.appendChild(btn);
  }
  fragment.appendChild(statusSeg);

  return fragment;
}

function buildPhoto(listing) {
  const urls = collectPhotoUrls(listing);
  if (urls.length === 0) return placeholderPhoto();

  const wrap = document.createElement('div');
  wrap.className = 'dp-carousel';

  const img = document.createElement('img');
  img.className = 'dp-photo is-clickable';
  img.loading = 'lazy';
  img.alt = '';
  img.title = 'Agrandir';
  img.addEventListener('click', () => {
    const usable = urls.filter((_, i) => !failed.has(i));
    if (usable.length === 0) return;
    const startUrl = urls[idx];
    const startIdx = Math.max(0, usable.indexOf(startUrl));
    openLightbox(usable, startIdx);
  });

  let idx = 0;
  const failed = new Set();

  const showAt = (i) => {
    if (urls.length === 0) return;
    // Skip indices we already know failed.
    let attempts = 0;
    let next = ((i % urls.length) + urls.length) % urls.length;
    while (failed.has(next) && attempts < urls.length) {
      next = ((next + 1) % urls.length);
      attempts += 1;
    }
    if (failed.size >= urls.length) {
      wrap.replaceWith(placeholderPhoto());
      return;
    }
    idx = next;
    img.src = urls[idx];
    if (counter) counter.textContent = (idx + 1) + ' / ' + urls.length;
  };

  img.addEventListener('error', () => {
    failed.add(idx);
    if (failed.size >= urls.length) {
      wrap.replaceWith(placeholderPhoto());
    } else {
      showAt(idx + 1);
    }
  });

  wrap.appendChild(img);

  let counter = null;
  if (urls.length > 1) {
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'dp-carousel-nav prev';
    prev.title = 'Photo précédente';
    prev.setAttribute('aria-label', 'Photo précédente');
    const prevIcon = document.createElement('i');
    prevIcon.className = 'fa-solid fa-chevron-left';
    prev.appendChild(prevIcon);
    prev.addEventListener('click', (e) => { e.stopPropagation(); showAt(idx - 1); });

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'dp-carousel-nav next';
    next.title = 'Photo suivante';
    next.setAttribute('aria-label', 'Photo suivante');
    const nextIcon = document.createElement('i');
    nextIcon.className = 'fa-solid fa-chevron-right';
    next.appendChild(nextIcon);
    next.addEventListener('click', (e) => { e.stopPropagation(); showAt(idx + 1); });

    counter = document.createElement('div');
    counter.className = 'dp-carousel-count';

    wrap.append(prev, next, counter);
  }

  showAt(0);
  return wrap;
}

function placeholderPhoto() {
  const fallback = document.createElement('div');
  fallback.className = 'dp-photo placeholder';
  const i = document.createElement('i');
  i.className = 'fa-regular fa-image';
  fallback.appendChild(i);
  return fallback;
}

function collectPhotoUrls(listing) {
  const seen = new Set();
  const out = [];
  const candidates = [
    ...(Array.isArray(listing.imageUrls) ? listing.imageUrls : []),
    ...(Array.isArray(listing.imageUrlsLocal) ? listing.imageUrlsLocal : []),
    ...(Array.isArray(listing.imageUrlsRemote) ? listing.imageUrlsRemote : []),
    listing.imageUrl
  ];
  for (const raw of candidates) {
    const url = sanitizeImageUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out.slice(0, 12);
}

function sanitizeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/data/profiles/')) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function statCell(label, value) {
  const cell = document.createElement('div');
  const span = document.createElement('span');
  span.textContent = label;
  const b = document.createElement('b');
  b.textContent = value;
  cell.append(span, b);
  return cell;
}

function pickListingDate(listing) {
  const published = formatRelativeDate(listing.publishedAt);
  if (published) return { label: 'Publié', text: published };
  const discovered = formatRelativeDate(listing.firstSeenAt);
  if (discovered) return { label: 'Découvert', text: discovered };
  return null;
}

function formatRelativeDate(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / (24 * 3600 * 1000));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return 'il y a ' + days + ' jours';
}

function formatRooms(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1);
}

function darken(hex) {
  // Light textual contrast — return the same hex; CSS will keep accessible.
  return hex;
}
