const cardsEl = document.getElementById('cards');
const rowsEl = document.getElementById('rows');
const mobileRowsEl = document.getElementById('mobile-rows');
const kanbanEl = document.getElementById('kanban-board');
const subEl = document.getElementById('sub');
const refreshBtn = document.getElementById('refresh');
const scanBtn = document.getElementById('scan');
const scanOut = document.getElementById('scan-output');
const filterEl = document.getElementById('priority-filter');
const sortEl = document.getElementById('sort-by');
const searchEl = document.getElementById('search-box');
const tabTableEl = document.getElementById('tab-table');
const tabKanbanEl = document.getElementById('tab-kanban');
const panelTableEl = document.getElementById('panel-table');
const panelKanbanEl = document.getElementById('panel-kanban');
const heroTitleEl = document.querySelector('.hero h1');
const zonesEl = document.getElementById('zones');

const profileSwitcherEl = document.getElementById('profile-switcher');

const PROFILE = (() => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[1] === 'dashboard') return parts[0];
  return new URLSearchParams(window.location.search).get('profile') || 'fribourg';
})();

const PROFILE_TITLES = {
  vevey: 'Vevey et environs',
  fribourg: 'Fribourg et environs',
  'saint-maurice': 'Saint-Maurice (VS)'
};

const PROFILE_ZONES = {
  vevey: 'Zones: Vevey · La Tour-de-Peilz · Corseaux · Corsier-sur-Vevey',
  fribourg: 'Zones: Châtel-Saint-Denis · Romont FR',
  'saint-maurice': 'Zone: Saint-Maurice (Valais)'
};

async function loadProfileSwitcher() {
  try {
    const res = await fetch('/api/profiles');
    const { profiles } = await res.json();
    if (!profileSwitcherEl || !Array.isArray(profiles)) return;

    profileSwitcherEl.innerHTML = '';
    for (const p of profiles) {
      const opt = document.createElement('option');
      opt.value = p.slug;
      opt.textContent = p.label || p.name;
      if (p.slug === PROFILE) opt.selected = true;
      profileSwitcherEl.appendChild(opt);
    }

    // Update title/zones from profile data
    const current = profiles.find((p) => p.slug === PROFILE);
    if (current) {
      if (heroTitleEl) heroTitleEl.textContent = PROFILE_TITLES[PROFILE] || current.name;
      if (zonesEl) zonesEl.textContent = current.areas ? `Zones: ${current.areas}` : '';
    }

    // Add "manage" option at the end
    const manageOpt = document.createElement('option');
    manageOpt.value = '__manage__';
    manageOpt.textContent = '⚙ Gérer les profils…';
    profileSwitcherEl.appendChild(manageOpt);

    profileSwitcherEl.addEventListener('change', () => {
      const selected = profileSwitcherEl.value;
      if (selected === '__manage__') {
        window.location.href = '/';
        return;
      }
      window.location.href = `/${encodeURIComponent(selected)}/dashboard`;
    });
  } catch {
    // Fallback: just show current profile
    if (profileSwitcherEl) {
      const opt = document.createElement('option');
      opt.value = PROFILE;
      opt.textContent = PROFILE_TITLES[PROFILE] || PROFILE;
      opt.selected = true;
      profileSwitcherEl.appendChild(opt);
    }
  }
}

loadProfileSwitcher();

if (heroTitleEl) {
  heroTitleEl.textContent = PROFILE_TITLES[PROFILE] || `Suivi ${PROFILE}`;
}
if (zonesEl) {
  zonesEl.textContent = PROFILE_ZONES[PROFILE] || '';
}
if (subEl) {
  subEl.textContent = `Profil: ${PROFILE} · chargement…`;
}

function apiUrl(pathname) {
  const sep = pathname.includes('?') ? '&' : '?';
  return `${pathname}${sep}profile=${encodeURIComponent(PROFILE)}`;
}

const DONE_STATUSES = new Set(['Accepté', 'Refusé']);
const REMOVED_KANBAN_STATUS = 'Retirées';

let statuses = [];
let allListings = [];
let latestState = { newCount: 0 };
let draggedKanbanId = null;
let scorePopoverEl = null;
let scorePopoverHideTimer = null;
let activeScoreTrigger = null;
let scorePopoverGlobalBound = false;
let activeCardFilter = 'all';

function money(v) {
  if (v == null) return 'n/a';
  return `CHF ${new Intl.NumberFormat('fr-CH').format(v)}`;
}

function shortWhen(iso) {
  if (!iso) return 'n/a';
  return new Date(iso).toLocaleString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function publishedMeta(item) {
  const publishedIso = item?.publishedAt;
  const firstSeenIso = item?.firstSeenAt;

  const parseDays = (iso) => {
    if (!iso) return null;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  };

  const publishedDays = parseDays(publishedIso);
  if (publishedDays != null) {
    return { days: publishedDays, approximate: false, iso: publishedIso };
  }

  const discoveredDays = parseDays(firstSeenIso);
  if (discoveredDays != null) {
    return { days: discoveredDays, approximate: true, iso: firstSeenIso };
  }

  return { days: null, approximate: false, iso: null };
}

function publishedLabel(item) {
  const meta = publishedMeta(item);
  if (meta.days == null) return 'N/A';
  return meta.approximate ? `${meta.days} j*` : `${meta.days} j`;
}

function publishedTitle(item) {
  const meta = publishedMeta(item);
  if (meta.days == null) return 'Date de parution indisponible';
  if (meta.approximate) return `Découverte le ${shortWhen(meta.iso)} (estimation)`;
  return `Publié le ${shortWhen(meta.iso)}`;
}

function distanceLabel(item) {
  if (item.distanceKm != null && Number.isFinite(Number(item.distanceKm))) {
    return `${Number(item.distanceKm).toFixed(1)} km`;
  }
  if (item.distanceText) return String(item.distanceText);
  return 'n/a';
}

function distanceBadge(item) {
  const span = document.createElement('span');
  span.className = 'distance-chip';
  span.textContent = distanceLabel(item);
  span.title = item.distanceFromWorkAddress
    ? `Distance estimée à vol d'oiseau depuis ${item.distanceFromWorkAddress}`
    : "Distance estimée à vol d'oiseau depuis le lieu de travail";
  return span;
}

function travelMinutesLabel(item, mode) {
  const minutes = mode === 'drive' ? item.driveMinutes : item.transitMinutes;
  const text = mode === 'drive' ? item.driveText : item.transitText;

  if (minutes != null && Number.isFinite(Number(minutes))) {
    return `${Math.round(Number(minutes))} min`;
  }

  if (text) return String(text);
  return 'n/a';
}

function createTravelCell(item) {
  const wrap = document.createElement('div');
  wrap.className = 'travel-cell';

  wrap.appendChild(distanceBadge(item));

  const lines = document.createElement('div');
  lines.className = 'travel-lines';
  lines.innerHTML = `
    <span>🚗 ${travelMinutesLabel(item, 'drive')}</span>
    <span>🚌 ${travelMinutesLabel(item, 'transit')}</span>
  `;

  wrap.appendChild(lines);
  return wrap;
}

function travelInlineLabel(item) {
  return `Travail: ${distanceLabel(item)} · 🚗 ${travelMinutesLabel(item, 'drive')} · 🚌 ${travelMinutesLabel(item, 'transit')}`;
}

function card(label, value, key = 'all') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card card-filter';
  if (activeCardFilter === key) button.classList.add('active');

  button.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
  button.addEventListener('click', () => {
    activeCardFilter = activeCardFilter === key ? 'all' : key;
    renderAll(latestState);
  });

  return button;
}

async function updateStatus(id, status, notes) {
  const res = await fetch(apiUrl('/api/update-status'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, status, notes })
  });
  const data = await res.json();
  return !!data.ok;
}

async function togglePin(id) {
  const res = await fetch(apiUrl('/api/toggle-pin'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id })
  });
  const data = await res.json();
  if (data.ok) {
    const item = allListings.find((x) => String(x.id) === String(id));
    if (item) item.pinned = data.pinned;
  }
  return data.ok ? data.pinned : null;
}

async function deleteListing(id) {
  const res = await fetch(apiUrl('/api/delete-listing'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id })
  });
  const data = await res.json();
  return !!data.ok;
}

function createPinButton(item) {
  const btn = document.createElement('button');
  btn.className = `pin-btn${item.pinned ? ' pinned' : ''}`;
  btn.title = item.pinned ? 'Désépingler' : 'Épingler en haut';
  btn.textContent = '📌';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    const pinned = await togglePin(item.id);
    if (pinned !== null) {
      item.pinned = pinned;
      renderAll(latestState);
    } else {
      btn.disabled = false;
    }
  });
  return btn;
}

function getImageUrls(item) {
  if (Array.isArray(item.imageUrlsLocal) && item.imageUrlsLocal.length) return item.imageUrlsLocal;
  if (Array.isArray(item.imageUrls) && item.imageUrls.length) return item.imageUrls;
  if (Array.isArray(item.imageUrlsRemote) && item.imageUrlsRemote.length) return item.imageUrlsRemote;
  if (item.imageUrl) return [item.imageUrl];
  return [];
}

function getUrgency(item) {
  if (item.isRemoved) return { level: 'done', label: 'Retirée' };

  const status = item.status || 'À contacter';
  if (DONE_STATUSES.has(status)) return { level: 'done', label: 'Clos' };
  if (status === 'Sans réponse' || status === 'Relance') return { level: 'high', label: 'Relance' };

  const refIso = item.updatedAt || item.firstSeenAt || item.lastSeenAt;
  const ageHours = refIso ? (Date.now() - new Date(refIso).getTime()) / 3600000 : 0;

  if (status === 'À contacter') {
    if (ageHours > 18) return { level: 'high', label: 'Urgent' };
    if (ageHours > 8) return { level: 'medium', label: 'Suivi' };
    return { level: 'low', label: 'OK' };
  }

  if (status === 'Visite') {
    if (ageHours > 36) return { level: 'high', label: 'Relance' };
    if (ageHours > 18) return { level: 'medium', label: 'Suivi' };
    return { level: 'low', label: 'OK' };
  }

  if (status === 'Dossier') {
    if (ageHours > 24) return { level: 'high', label: 'Urgent' };
    if (ageHours > 12) return { level: 'medium', label: 'Suivi' };
    return { level: 'low', label: 'OK' };
  }

  return { level: 'low', label: 'OK' };
}

function listingSourceLabel(item) {
  const raw = String(item?.source || '').trim().toLowerCase();
  if (raw.includes('immobilier')) return 'immobilier.ch';
  if (raw.includes('flatfox')) return 'flatfox.ch';

  const url = String(item?.url || '').trim();
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
      if (host) return host;
    } catch {
      // noop
    }
  }

  return raw || null;
}

function sourceMetaHtml(item) {
  const source = listingSourceLabel(item);
  if (!source) return '';
  return `<span class="meta-source">source: ${escapeHtml(source)}</span>`;
}

function isNewToday(item) {
  if (!item.firstSeenAt) return false;
  const seen = new Date(item.firstSeenAt);
  const today = new Date();
  return seen.getFullYear() === today.getFullYear()
    && seen.getMonth() === today.getMonth()
    && seen.getDate() === today.getDate();
}

function stateBadgesHtml(item) {
  const badges = [];
  if (isNewToday(item) && !item.isRemoved) badges.push('<span class="state-badge new">Nouveau</span>');
  if (item.isRemoved) badges.push('<span class="state-badge removed">Retirée</span>');

  return badges.length ? `<div class="state-badges">${badges.join('')}</div>` : '';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreLines(item) {
  if (Array.isArray(item.scoreBreakdown) && item.scoreBreakdown.length) return item.scoreBreakdown;
  if (!item.scoreTooltip) return [];

  return String(item.scoreTooltip)
    .split(/[|·]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^score\s*:/i.test(x));
}

function encodeScorePayload(item) {
  const payload = {
    score: item.score ?? 'n/a',
    lines: scoreLines(item)
  };
  return encodeURIComponent(JSON.stringify(payload));
}

function decodeScorePayload(el) {
  try {
    return JSON.parse(decodeURIComponent(el?.dataset?.scorePayload || ''));
  } catch {
    return { score: 'n/a', lines: [] };
  }
}

function scorePercent(item) {
  const raw = Number(item.score ?? 0);
  return Math.max(0, Math.min(100, raw));
}

function ensureScorePopover() {
  if (!scorePopoverEl) {
    scorePopoverEl = document.createElement('div');
    scorePopoverEl.className = 'score-popover-floating';
    scorePopoverEl.setAttribute('role', 'tooltip');
    document.body.appendChild(scorePopoverEl);
  }

  if (!scorePopoverGlobalBound) {
    document.addEventListener('click', (event) => {
      if (!activeScoreTrigger || !scorePopoverEl?.classList.contains('visible')) return;
      if (activeScoreTrigger.contains(event.target)) return;
      hideScorePopover();
    });

    window.addEventListener('scroll', hideScorePopover, { passive: true });
    window.addEventListener('resize', hideScorePopover);
    scorePopoverGlobalBound = true;
  }

  return scorePopoverEl;
}

function placeScorePopover(trigger, pop) {
  const rect = trigger.getBoundingClientRect();
  const margin = 10;

  const width = pop.offsetWidth || 260;
  const height = pop.offsetHeight || 120;

  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  let top = rect.top - height - 8;
  if (top < margin) top = rect.bottom + 8;

  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function showScorePopover(trigger) {
  const pop = ensureScorePopover();
  clearTimeout(scorePopoverHideTimer);

  const payload = decodeScorePayload(trigger);
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const listHtml = lines.length
    ? `<ul class="score-pop-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : '<div class="score-pop-empty">Pas de détail disponible</div>';

  pop.innerHTML = `<div class="score-pop-title">Score ${escapeHtml(payload.score)}</div>${listHtml}`;
  pop.classList.add('visible');
  activeScoreTrigger = trigger;
  placeScorePopover(trigger, pop);
}

function hideScorePopover() {
  if (!scorePopoverEl) return;
  scorePopoverEl.classList.remove('visible');
  activeScoreTrigger = null;
}

function scheduleHideScorePopover() {
  clearTimeout(scorePopoverHideTimer);
  scorePopoverHideTimer = setTimeout(() => {
    hideScorePopover();
  }, 80);
}

function bindScorePopovers() {
  ensureScorePopover();

  document.querySelectorAll('.score-trigger').forEach((el) => {
    if (el.dataset.scorePopoverBound === '1') return;
    el.dataset.scorePopoverBound = '1';

    el.addEventListener('mouseenter', () => showScorePopover(el));
    el.addEventListener('mouseleave', scheduleHideScorePopover);
    el.addEventListener('focus', () => showScorePopover(el));
    el.addEventListener('blur', hideScorePopover);

    el.addEventListener('click', (event) => {
      event.preventDefault();
      if (activeScoreTrigger === el && scorePopoverEl?.classList.contains('visible')) {
        hideScorePopover();
      } else {
        showScorePopover(el);
      }
    });

    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showScorePopover(el);
      }
      if (event.key === 'Escape') {
        hideScorePopover();
      }
    });
  });
}

function createScoreDisplay(item) {
  const wrap = document.createElement('div');
  wrap.className = 'score-wrap score-trigger';
  wrap.dataset.scorePayload = encodeScorePayload(item);
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('aria-label', `Détails du score ${item.score ?? 'n/a'}`);

  const pill = document.createElement('span');
  pill.className = 'score-pill';
  pill.textContent = item.score ?? '-';

  const track = document.createElement('span');
  track.className = 'score-track';
  const fill = document.createElement('span');
  fill.className = 'score-fill';
  fill.style.width = `${scorePercent(item)}%`;
  track.appendChild(fill);

  wrap.append(pill, track);
  return wrap;
}

function scoreMiniHtml(item) {
  return `<span class="score-mini score-trigger" data-score-payload="${encodeScorePayload(item).replace(/"/g, '&quot;')}" tabindex="0" role="button" aria-label="Détails du score ${item.score ?? 'n/a'}"><span class="score-pill">${item.score ?? '-'}</span><span class="score-track"><span class="score-fill" style="width:${scorePercent(item)}%"></span></span></span>`;
}

function matchesCardFilter(item, key) {
  if (key === 'all') return true;
  if (key === 'top') return !item.isRemoved && String(item.priority || '').startsWith('A');
  if (key === 'pearl') return !item.isRemoved && !!item.isPearl;
  if (key === 'transition') return !item.isRemoved && (String(item.priority || '') === 'B' || (item.rooms ?? 0) < 2);
  if (key === 'urgent') return !item.isRemoved && getUrgency(item).level === 'high';
  if (key === 'new') return !item.isRemoved && isNewToday(item);
  if (key === 'removed') return !!item.isRemoved;
  return true;
}

function applyFilterAndSort(items) {
  const mode = filterEl.value;
  const sortBy = sortEl.value;
  const q = (searchEl.value || '').trim().toLowerCase();

  let out = [...items].filter((item) => {
    if (mode === 'top') {
      return !item.isRemoved && String(item.priority || '').startsWith('A');
    }
    if (mode === 'transition') {
      return !item.isRemoved && (String(item.priority || '') === 'B' || (item.rooms ?? 0) < 2);
    }
    if (mode === 'pearl') {
      return !item.isRemoved && !!item.isPearl;
    }
    return true;
  });

  if (q) {
    out = out.filter((item) => {
      const hay = `${item.objectType || ''} ${item.address || ''} ${item.area || ''} ${item.title || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (activeCardFilter !== 'all') {
    out = out.filter((item) => matchesCardFilter(item, activeCardFilter));
  }

  out.sort((a, b) => {
    // Pinned items always first
    const aPin = a.pinned ? 1 : 0;
    const bPin = b.pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;

    const aGrey = (a.isRemoved || isRefused(a)) ? 1 : 0;
    const bGrey = (b.isRemoved || isRefused(b)) ? 1 : 0;
    if (aGrey !== bGrey) return aGrey - bGrey;

    if (sortBy === 'price') return (a.totalChf || 999999) - (b.totalChf || 999999);
    if (sortBy === 'area') return String(a.area || '').localeCompare(String(b.area || ''), 'fr-CH');
    if (sortBy === 'date') {
      const aDays = publishedMeta(a).days ?? Infinity;
      const bDays = publishedMeta(b).days ?? Infinity;
      return aDays - bDays;
    }
    return (b.score || 0) - (a.score || 0);
  });

  return out;
}

function createStatusSelect(item) {
  const select = document.createElement('select');
  for (const st of statuses) {
    const opt = document.createElement('option');
    opt.value = st;
    opt.textContent = st;
    if (st === item.status) opt.selected = true;
    select.appendChild(opt);
  }
  return select;
}

function createSaveButton(handler) {
  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-inline';
  saveBtn.textContent = 'Sauver';
  saveBtn.addEventListener('click', async () => {
    saveBtn.textContent = '…';
    saveBtn.disabled = true;
    const ok = await handler();
    saveBtn.textContent = ok ? 'Sauvé ✓' : 'Erreur';
    setTimeout(() => {
      saveBtn.textContent = 'Sauver';
      saveBtn.disabled = false;
    }, 900);
  });
  return saveBtn;
}

function clearKanbanDropTargets() {
  document.querySelectorAll('.kanban-items.drop-target').forEach((el) => el.classList.remove('drop-target'));
}

function attachKanbanDropzone(body, targetStatus) {
  body.dataset.status = targetStatus;

  body.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    body.classList.add('drop-target');
  });

  body.addEventListener('dragenter', (event) => {
    event.preventDefault();
    body.classList.add('drop-target');
  });

  body.addEventListener('dragleave', (event) => {
    if (!body.contains(event.relatedTarget)) {
      body.classList.remove('drop-target');
    }
  });

  body.addEventListener('drop', async (event) => {
    event.preventDefault();
    body.classList.remove('drop-target');

    const droppedId = event.dataTransfer.getData('text/plain') || draggedKanbanId;
    if (!droppedId) return;

    const item = allListings.find((x) => String(x.id) === String(droppedId));
    if (!item) return;
    if (item.isRemoved) return;
    if ((item.status || 'À contacter') === targetStatus) return;

    const ok = await updateStatus(item.id, targetStatus, item.notes || '');
    if (ok) await load();
  });
}

function setActiveView(view, persist = true) {
  const tableActive = view !== 'kanban';

  tabTableEl.classList.toggle('active', tableActive);
  tabKanbanEl.classList.toggle('active', !tableActive);
  panelTableEl.classList.toggle('active', tableActive);
  panelKanbanEl.classList.toggle('active', !tableActive);

  if (persist) {
    localStorage.setItem('apartment-dashboard:view', tableActive ? 'table' : 'kanban');
  }
}

function initViewTabs() {
  const saved = localStorage.getItem('apartment-dashboard:view');
  setActiveView(saved === 'kanban' ? 'kanban' : 'table', false);

  tabTableEl.addEventListener('click', () => setActiveView('table'));
  tabKanbanEl.addEventListener('click', () => setActiveView('kanban'));
}

function createThumbCell(item) {
  const urls = getImageUrls(item);
  const holder = document.createElement('div');
  holder.className = 'thumb-stack';

  if (!urls.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'thumb placeholder';
    placeholder.textContent = 'n/a';
    holder.appendChild(placeholder);
    return holder;
  }

  const mainLink = document.createElement('a');
  mainLink.href = item.url;
  mainLink.target = '_blank';
  mainLink.rel = 'noreferrer';

  const img = document.createElement('img');
  img.className = 'thumb';
  img.src = urls[0];
  img.loading = 'lazy';
  img.alt = `Aperçu ${item.objectType || item.title || 'annonce'}`;
  mainLink.appendChild(img);
  holder.appendChild(mainLink);

  if (urls.length > 1) {
    const strip = document.createElement('div');
    strip.className = 'thumb-strip';

    for (const src of urls.slice(1, 4)) {
      const mini = document.createElement('img');
      mini.className = 'thumb-mini';
      mini.src = src;
      mini.loading = 'lazy';
      mini.alt = 'miniature';
      strip.appendChild(mini);
    }

    if (urls.length > 4) {
      const more = document.createElement('span');
      more.className = 'thumb-more';
      more.textContent = `+${urls.length - 4}`;
      strip.appendChild(more);
    }

    holder.appendChild(strip);
  }

  return holder;
}

function isRefused(item) {
  return !item.isRemoved && (item.status || '') === 'Refusé';
}

function createUrgencyBadge(item) {
  const urgency = getUrgency(item);
  const badge = document.createElement('span');
  badge.className = `urgency-badge ${urgency.level}`;
  badge.textContent = urgency.label;
  badge.title = `Dernière activité: ${shortWhen(item.updatedAt || item.firstSeenAt || item.lastSeenAt)}`;
  return badge;
}

function renderDesktop(listings) {
  rowsEl.innerHTML = '';

  if (!listings.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="10"><div class="empty">Aucune annonce ne correspond aux filtres.</div></td>`;
    rowsEl.appendChild(tr);
    return;
  }

  for (const item of listings) {
    const tr = document.createElement('tr');
    if (item.isRemoved) tr.classList.add('row-removed');
    if (isRefused(item)) tr.classList.add('row-refused');
    if (isNewToday(item) && !item.isRemoved) tr.classList.add('row-new');

    const tdPriority = document.createElement('td');
    tdPriority.innerHTML = `<span class="tag">${item.priority || '-'}</span>`;

    const tdScore = document.createElement('td');
    tdScore.appendChild(createScoreDisplay(item));

    const tdImage = document.createElement('td');
    tdImage.appendChild(createThumbCell(item));

    const tdInfo = document.createElement('td');
    tdInfo.innerHTML = `<a href="${item.url}" target="_blank" rel="noreferrer">${item.objectType || item.title}</a><div class="small">${item.address || ''}${sourceMetaHtml(item) ? ` · ${sourceMetaHtml(item)}` : ''}</div>${stateBadgesHtml(item)}`;

    const tdPrice = document.createElement('td');
    tdPrice.innerHTML = `<div>${money(item.totalChf)}</div><div class="small">${item.priceRaw || ''}</div>`;

    const tdPublished = document.createElement('td');
    tdPublished.textContent = publishedLabel(item);
    tdPublished.title = publishedTitle(item);

    const tdDistance = document.createElement('td');
    tdDistance.appendChild(createTravelCell(item));

    const tdStatus = document.createElement('td');
    const select = createStatusSelect(item);
    if (item.isRemoved) select.disabled = true;
    tdStatus.appendChild(select);

    const tdNotes = document.createElement('td');
    const notesInput = document.createElement('input');
    notesInput.value = item.notes || '';
    notesInput.placeholder = 'notes';
    if (item.isRemoved) notesInput.disabled = true;
    tdNotes.appendChild(notesInput);

    if (!item.isRemoved) {
      select.addEventListener('change', async () => {
        select.disabled = true;
        await updateStatus(item.id, select.value, notesInput.value);
        await load();
      });
    }

    const tdAction = document.createElement('td');
    const actionCell = document.createElement('div');
    actionCell.className = 'action-cell';

    if (item.isRemoved) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'save-inline danger';
      deleteBtn.textContent = 'Supprimer';
      deleteBtn.addEventListener('click', async () => {
        const okConfirm = window.confirm('Supprimer cette annonce retirée du suivi ?');
        if (!okConfirm) return;
        deleteBtn.disabled = true;
        deleteBtn.textContent = '…';
        const ok = await deleteListing(item.id);
        if (ok) await load();
        else {
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Supprimer';
        }
      });
      actionCell.appendChild(deleteBtn);
    } else {
      const pinBtn = createPinButton(item);
      const saveBtn = createSaveButton(() => updateStatus(item.id, select.value, notesInput.value));
      actionCell.append(pinBtn, saveBtn);
    }

    tdAction.appendChild(actionCell);

    if (item.pinned) tr.classList.add('row-pinned');
    tr.append(tdPriority, tdScore, tdImage, tdInfo, tdPrice, tdPublished, tdDistance, tdStatus, tdNotes, tdAction);
    rowsEl.appendChild(tr);
  }
}

function renderKanban(listings) {
  draggedKanbanId = null;
  kanbanEl.innerHTML = '';

  if (!listings.length) {
    kanbanEl.innerHTML = '<div class="empty">Aucune annonce pour ce filtre.</div>';
    return;
  }

  const baseStatuses = (statuses.length
    ? statuses
    : ['À contacter', 'Visite', 'Dossier', 'Relance', 'Accepté', 'Refusé', 'Sans réponse'])
    .slice();
  const orderedStatuses = [...baseStatuses, REMOVED_KANBAN_STATUS];

  for (const status of orderedStatuses) {
    const colItems = status === REMOVED_KANBAN_STATUS
      ? listings.filter((x) => x.isRemoved)
      : listings.filter((x) => !x.isRemoved && (x.status || 'À contacter') === status);

    const col = document.createElement('section');
    col.className = 'kanban-col';

    const head = document.createElement('header');
    head.className = 'kanban-head';
    head.innerHTML = `<h3>${status}</h3><span>${colItems.length}</span>`;
    col.appendChild(head);

    const body = document.createElement('div');
    body.className = 'kanban-items';
    if (status !== REMOVED_KANBAN_STATUS) {
      attachKanbanDropzone(body, status);
    }

    if (!colItems.length) {
      const empty = document.createElement('div');
      empty.className = 'kanban-empty';
      empty.textContent = '—';
      body.appendChild(empty);
    }

    for (const item of colItems) {
      const kCard = document.createElement('article');
      kCard.className = 'k-card';
      if (item.isRemoved) kCard.classList.add('removed');
      if (isRefused(item)) kCard.classList.add('refused');
      if (isNewToday(item) && !item.isRemoved) kCard.classList.add('new');
      if (item.pinned) kCard.classList.add('pinned');

      if (!item.isRemoved) {
        kCard.draggable = true;
        kCard.dataset.id = String(item.id);

        kCard.addEventListener('dragstart', (event) => {
          draggedKanbanId = String(item.id);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(item.id));
          kCard.classList.add('dragging');
        });

        kCard.addEventListener('dragend', () => {
          draggedKanbanId = null;
          kCard.classList.remove('dragging');
          clearKanbanDropTargets();
        });
      }

      const urls = getImageUrls(item);
      const cover = urls[0] || '';

      kCard.innerHTML = `
        ${cover ? `<img class="k-cover" src="${cover}" alt="Aperçu ${item.objectType || item.title}" loading="lazy" />` : '<div class="k-cover"></div>'}
        <div class="k-body">
          <div class="k-meta-top">
            <span class="tag">${item.priority || '-'}</span>
            ${scoreMiniHtml(item)}
            <span class="k-price">${money(item.totalChf)}</span>
          </div>
          <a href="${item.url}" target="_blank" rel="noreferrer" class="k-title">${item.objectType || item.title}</a>
          <div class="k-sub">${item.area || '-'} · ${item.address || ''}${sourceMetaHtml(item) ? ` · ${sourceMetaHtml(item)}` : ''}</div>
          <div class="k-distance">${travelInlineLabel(item)}</div>
          <div class="k-sub">Publié: ${publishedLabel(item)}</div>
          ${stateBadgesHtml(item)}
          <div class="k-bottom"></div>
        </div>
      `;

      const bottom = kCard.querySelector('.k-bottom');
      const urgency = createUrgencyBadge(item);
      bottom.appendChild(urgency);

      if (urls.length > 1) {
        const mini = document.createElement('div');
        mini.className = 'k-mini-strip';
        urls.slice(1, 4).forEach((src) => {
          const im = document.createElement('img');
          im.src = src;
          im.loading = 'lazy';
          im.alt = 'miniature';
          mini.appendChild(im);
        });
        bottom.appendChild(mini);
      }

      const actions = document.createElement('div');
      actions.className = 'k-actions';
      actions.addEventListener('dragstart', (event) => event.preventDefault());

      if (!item.isRemoved) {
        const pinBtn = createPinButton(item);
        pinBtn.draggable = false;

        const select = createStatusSelect(item);
        select.draggable = false;

        select.addEventListener('change', async () => {
          select.disabled = true;
          await updateStatus(item.id, select.value, item.notes || '');
          await load();
        });

        actions.append(pinBtn, select);
      } else {
        const retired = document.createElement('div');
        retired.className = 'k-retired-note';
        retired.textContent = `Retirée le ${shortWhen(item.removedAt || item.lastSeenAt)}`;

        const del = document.createElement('button');
        del.className = 'save-inline danger';
        del.textContent = 'Supprimer';
        del.addEventListener('click', async () => {
          const okConfirm = window.confirm('Supprimer cette annonce retirée du suivi ?');
          if (!okConfirm) return;
          del.disabled = true;
          del.textContent = '…';
          const ok = await deleteListing(item.id);
          if (ok) await load();
          else {
            del.disabled = false;
            del.textContent = 'Supprimer';
          }
        });

        actions.append(retired, del);
      }

      kCard.querySelector('.k-body').appendChild(actions);

      body.appendChild(kCard);
    }

    col.appendChild(body);
    kanbanEl.appendChild(col);
  }
}

function renderMobile(listings) {
  mobileRowsEl.innerHTML = '';

  if (!listings.length) {
    mobileRowsEl.innerHTML = '<div class="empty">Aucune annonce ne correspond aux filtres.</div>';
    return;
  }

  for (const item of listings) {
    const card = document.createElement('article');
    card.className = 'mobile-card';
    if (item.isRemoved) card.classList.add('removed');
    if (isRefused(item)) card.classList.add('refused');
    if (isNewToday(item) && !item.isRemoved) card.classList.add('new');

    const urls = getImageUrls(item);
    const cover = urls[0] || '';

    card.innerHTML = `
      ${cover ? `<img class="mobile-cover" src="${cover}" alt="Aperçu ${item.objectType || item.title}" loading="lazy" />` : '<div class="mobile-cover"></div>'}
      <div class="mobile-content">
        <h3 class="mobile-title"><span class="tag">${item.priority || '-'}</span> ${scoreMiniHtml(item)} <a href="${item.url}" target="_blank" rel="noreferrer">${item.objectType || item.title}</a></h3>
        <div class="mobile-meta">
          <div>${item.address || ''}</div>
          <div>${item.area || '-'} · ${money(item.totalChf)}${sourceMetaHtml(item) ? ` · ${sourceMetaHtml(item)}` : ''}</div>
          <div>${travelInlineLabel(item)}</div>
          <div>Publié: ${publishedLabel(item)}</div>
          <div>${item.priceRaw || ''}</div>
          ${stateBadgesHtml(item)}
          <div class="mobile-urgency"></div>
        </div>
      </div>
    `;

    const urgency = createUrgencyBadge(item);
    card.querySelector('.mobile-urgency').appendChild(urgency);

    if (urls.length > 1) {
      const strip = document.createElement('div');
      strip.className = 'mobile-thumb-strip';
      urls.slice(1, 5).forEach((src) => {
        const im = document.createElement('img');
        im.src = src;
        im.loading = 'lazy';
        im.alt = 'miniature';
        strip.appendChild(im);
      });
      card.querySelector('.mobile-content').appendChild(strip);
    }

    const controls = document.createElement('div');
    controls.className = 'mobile-controls';

    if (!item.isRemoved) {
      const pinBtn = createPinButton(item);
      const select = createStatusSelect(item);
      const notesInput = document.createElement('input');
      notesInput.value = item.notes || '';
      notesInput.placeholder = 'notes';

      select.addEventListener('change', async () => {
        select.disabled = true;
        await updateStatus(item.id, select.value, notesInput.value);
        await load();
      });

      const pinRow = document.createElement('div');
      pinRow.className = 'mobile-pin-row';
      pinRow.append(pinBtn, select);

      const saveBtn = createSaveButton(() => updateStatus(item.id, select.value, notesInput.value));
      controls.append(pinRow, notesInput, saveBtn);
    } else {
      const retired = document.createElement('div');
      retired.className = 'k-retired-note';
      retired.textContent = `Annonce retirée le ${shortWhen(item.removedAt || item.lastSeenAt)}`;

      const del = document.createElement('button');
      del.className = 'save-inline danger';
      del.textContent = 'Supprimer';
      del.addEventListener('click', async () => {
        const okConfirm = window.confirm('Supprimer cette annonce retirée du suivi ?');
        if (!okConfirm) return;
        del.disabled = true;
        del.textContent = '…';
        const ok = await deleteListing(item.id);
        if (ok) await load();
        else {
          del.disabled = false;
          del.textContent = 'Supprimer';
        }
      });

      controls.append(retired, del);
    }

    if (item.pinned) card.classList.add('row-pinned');
    card.querySelector('.mobile-content').appendChild(controls);
    mobileRowsEl.appendChild(card);
  }
}

function renderCards(listings, latest) {
  const top = listings.filter((x) => String(x.priority || '').startsWith('A') && !x.isRemoved).length;
  const pearls = listings.filter((x) => !!x.isPearl && !x.isRemoved).length;
  const priorityB = listings.filter((x) => (String(x.priority || '') === 'B' || (x.rooms ?? 0) < 2) && !x.isRemoved).length;
  const urgent = listings.filter((x) => getUrgency(x).level === 'high' && !x.isRemoved).length;
  const removed = listings.filter((x) => !!x.isRemoved).length;
  const news = listings.filter((x) => isNewToday(x) && !x.isRemoved).length;

  cardsEl.innerHTML = '';
  cardsEl.append(
    card('Annonces visibles', listings.length, 'all'),
    card('Priorité haute', top, 'top'),
    card('Perles ⭐', pearls, 'pearl'),
    card('Urgentes', urgent, 'urgent'),
    card('Priorité B', priorityB, 'transition'),
    card('Nouvelles', news, 'new'),
    card('Retirées', removed, 'removed')
  );
}

function renderAll(latest) {
  hideScorePopover();
  const filtered = applyFilterAndSort(allListings);
  renderCards(allListings, latest);
  renderKanban(filtered);
  renderDesktop(filtered);
  renderMobile(filtered);
  bindScorePopovers();
}

async function load() {
  const res = await fetch(apiUrl('/api/state'));
  const { tracker, latest, profile } = await res.json();

  statuses = tracker.statuses || [];
  allListings = (tracker.listings || []).filter((x) => x.display !== false);
  latestState = latest || { newCount: 0 };

  const activeCount = allListings.filter((x) => !x.isRemoved).length;
  const removedCount = allListings.filter((x) => x.isRemoved).length;

  const effectiveProfile = String(profile || PROFILE || 'vevey');
  if (heroTitleEl) {
    heroTitleEl.textContent = PROFILE_TITLES[effectiveProfile] || `Suivi ${effectiveProfile}`;
  }
  if (zonesEl) {
    zonesEl.textContent = PROFILE_ZONES[effectiveProfile] || '';
  }

  subEl.textContent = `Profil: ${effectiveProfile} · Dernier scan: ${shortWhen(latest.generatedAt)} · ${activeCount} actives · ${removedCount} retirées`;
  renderAll(latestState);
}

refreshBtn.addEventListener('click', load);
filterEl.addEventListener('change', () => renderAll(latestState));
sortEl.addEventListener('change', () => {
  localStorage.setItem('apartment-search-sort', sortEl.value);
  renderAll(latestState);
});
searchEl.addEventListener('input', () => renderAll(latestState));

// Restaurer le tri depuis localStorage au chargement
const savedSort = localStorage.getItem('apartment-search-sort');
if (savedSort && sortEl.querySelector(`option[value="${savedSort}"]`)) {
  sortEl.value = savedSort;
}

scanBtn.addEventListener('click', async () => {
  scanBtn.disabled = true;
  scanOut.classList.remove('hidden');
  scanOut.textContent = 'Scan en cours…';

  try {
    const res = await fetch(apiUrl('/api/run-scan'), { method: 'POST' });
    const data = await res.json();
    scanOut.textContent = data.ok ? data.summary : `Erreur: ${data.error}`;
    await load();
  } catch (err) {
    scanOut.textContent = `Erreur: ${err.message}`;
  } finally {
    scanBtn.disabled = false;
  }
});

initViewTabs();
load();
