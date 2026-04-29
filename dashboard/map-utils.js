const PROFILE_COLORS = [
  '#56d4b8',
  '#8aa6ff',
  '#ffcf6e',
  '#e9788f',
  '#9ee66f',
  '#c58bff',
  '#66c7f4',
  '#ff9f6e',
  '#d6e16f',
  '#f27bd5'
];

export function profileColor(slug = '') {
  const text = String(slug || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return PROFILE_COLORS[hash % PROFILE_COLORS.length];
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function moneyLabel(value) {
  if (value == null || value === '') return 'CHF -';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'CHF -';
  return `CHF ${new Intl.NumberFormat('fr-CH').format(n).replace(/[\s\u202f]/g, "'")}`;
}

export function roomsLabel(value) {
  if (value == null || value === '') return '- p';
  const n = Number(value);
  if (!Number.isFinite(n)) return '- p';
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)} p`;
}

export function surfaceLabel(value) {
  if (value == null || value === '') return '- m2';
  const n = Number(value);
  if (!Number.isFinite(n)) return '- m2';
  return `${Math.round(n)} m2`;
}

export function formatMarkerDetails(item = {}) {
  return `${moneyLabel(item.totalChf)} · ${roomsLabel(item.rooms)} · ${surfaceLabel(item.surfaceM2)}`;
}

function safePopupUrl(value) {
  if (!value) return '';

  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function safeImageUrl(value) {
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

function listingImageUrls(item = {}) {
  return [...new Set([
    ...(Array.isArray(item.imageUrls) ? item.imageUrls : []),
    ...(Array.isArray(item.imageUrlsLocal) ? item.imageUrlsLocal : []),
    ...(Array.isArray(item.imageUrlsRemote) ? item.imageUrlsRemote : []),
    item.imageUrl
  ].map(safeImageUrl).filter(Boolean))].slice(0, 8);
}

function popupCarouselHtml(item = {}) {
  const imageUrls = listingImageUrls(item);
  if (!imageUrls.length) return '';

  const title = item.title || item.address || 'annonce';
  const thumbs = imageUrls.map((src, index) => `
    <button class="map-popup-carousel-thumb ${index === 0 ? 'active' : ''}" type="button" data-carousel-thumb data-carousel-index="${index}" data-carousel-url="${escapeHtml(src)}" aria-label="Photo ${index + 1}">
      <img src="${escapeHtml(src)}" alt="Photo ${index + 1}" loading="lazy" />
    </button>
  `).join('');
  const controls = imageUrls.length > 1
    ? `
      <button class="map-popup-carousel-nav prev" type="button" data-carousel-prev aria-label="Photo précédente">‹</button>
      <button class="map-popup-carousel-nav next" type="button" data-carousel-next aria-label="Photo suivante">›</button>
    `
    : '';
  const counter = imageUrls.length > 1
    ? `<div class="map-popup-carousel-count" data-carousel-count>1 / ${imageUrls.length}</div>`
    : '';

  return `
    <div class="map-popup-carousel" data-carousel-index="0">
      <div class="map-popup-carousel-main">
        <img class="map-popup-carousel-image" data-carousel-current src="${escapeHtml(imageUrls[0])}" alt="Photo ${escapeHtml(title)}" loading="lazy" />
        ${controls}
        ${counter}
      </div>
      ${imageUrls.length > 1 ? `<div class="map-popup-carousel-thumbs">${thumbs}</div>` : ''}
    </div>
  `;
}

export function popupHtml(item = {}) {
  const title = item.title || item.address || 'Annonce';
  const meta = [
    moneyLabel(item.totalChf),
    roomsLabel(item.rooms),
    surfaceLabel(item.surfaceM2)
  ].join(' · ');

  const source = item.source ? `<div class="map-popup-muted">${escapeHtml(item.source)}</div>` : '';
  const area = item.area ? `<div class="map-popup-muted">${escapeHtml(item.area)}</div>` : '';
  const address = item.address ? `<div>${escapeHtml(item.address)}</div>` : '';
  const url = safePopupUrl(item.url);
  const link = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Ouvrir l'annonce</a>`
    : '';
  const carousel = popupCarouselHtml(item);

  return `
    <div class="map-popup">
      ${carousel}
      <div class="map-popup-profile">${escapeHtml(item.profileTitle || item.profileSlug || '')}</div>
      <strong>${escapeHtml(title)}</strong>
      ${address}
      ${area}
      <div>${escapeHtml(meta)}</div>
      ${source}
      ${link}
    </div>
  `;
}
