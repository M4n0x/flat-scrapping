// Fullscreen image viewer for the listing-detail gallery.

let activeOverlay = null;

export function openLightbox(urls, startIdx = 0) {
  closeLightbox();
  if (!Array.isArray(urls) || urls.length === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.tabIndex = -1;

  const img = document.createElement('img');
  img.className = 'lightbox-img';
  img.alt = '';

  const counter = document.createElement('div');
  counter.className = 'lightbox-count';

  const closeBtn = makeBtn('lightbox-close', 'fa-xmark', 'Fermer');
  closeBtn.addEventListener('click', closeLightbox);

  let idx = clampIndex(startIdx, urls.length);

  const show = (i) => {
    idx = clampIndex(i, urls.length);
    img.src = urls[idx];
    counter.textContent = (idx + 1) + ' / ' + urls.length;
  };

  overlay.append(img, counter, closeBtn);

  if (urls.length > 1) {
    const prev = makeBtn('lightbox-nav prev', 'fa-chevron-left', 'Photo précédente');
    prev.addEventListener('click', (e) => { e.stopPropagation(); show(idx - 1); });
    const next = makeBtn('lightbox-nav next', 'fa-chevron-right', 'Photo suivante');
    next.addEventListener('click', (e) => { e.stopPropagation(); show(idx + 1); });
    overlay.append(prev, next);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeLightbox();
  });

  const onKey = (e) => {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft' && urls.length > 1) show(idx - 1);
    else if (e.key === 'ArrowRight' && urls.length > 1) show(idx + 1);
  };
  document.addEventListener('keydown', onKey);

  activeOverlay = { overlay, onKey };
  document.body.appendChild(overlay);
  overlay.focus();
  show(idx);
}

export function closeLightbox() {
  if (!activeOverlay) return;
  document.removeEventListener('keydown', activeOverlay.onKey);
  activeOverlay.overlay.remove();
  activeOverlay = null;
}

function clampIndex(i, n) {
  return ((i % n) + n) % n;
}

function makeBtn(className, iconClass, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  const icon = document.createElement('i');
  icon.className = 'fa-solid ' + iconClass;
  btn.appendChild(icon);
  return btn;
}
