// Floating filter panels — Profils chips + QuickSorts (status + recency).
// Replaces the previous multi-section sidebar.

const STATUS_DEFS = [
  {
    key: 'sorting',
    label: 'À trier',
    hint: 'Nouvelles annonces',
    tone: 'amber',
    iconClass: 'fa-solid fa-clock-rotate-left'
  },
  {
    key: 'pursuing',
    label: 'À poursuivre',
    hint: 'En cours',
    tone: 'green',
    iconClass: 'fa-solid fa-check'
  },
  {
    key: 'archived',
    label: 'Archivé',
    hint: 'Mis de côté',
    tone: 'slate',
    iconClass: 'fa-solid fa-box-archive'
  }
];

const RECENCY_OPTS = [
  { v: 'any', l: 'Toutes' },
  { v: '1d',  l: '24h' },
  { v: '3d',  l: '3j' },
  { v: '7d',  l: '7j' },
  { v: '14d', l: '14j' }
];

export function renderProfilesPanel({ profiles }, state, handlers) {
  const chipsEl = document.getElementById('profiles-chips');
  const addBtn = document.getElementById('profiles-add');
  const unreadEl = document.getElementById('filter-unread');

  if (!chipsEl) return;

  chipsEl.replaceChildren();

  if (!profiles.length) {
    const empty = document.createElement('div');
    empty.className = 'empty small';
    empty.textContent = 'Aucun profil. Cliquez « + nouveau ».';
    chipsEl.appendChild(empty);
  }

  for (const profile of profiles) {
    chipsEl.appendChild(buildChip(profile, state, handlers));
  }

  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', () => handlers.onAddProfile && handlers.onAddProfile());
  }

  if (unreadEl && !unreadEl.dataset.bound) {
    unreadEl.dataset.bound = '1';
    unreadEl.addEventListener('change', () => {
      handlers.onChange((next) => { next.unreadOnly = unreadEl.checked; });
    });
  }
  if (unreadEl) unreadEl.checked = !!state.unreadOnly;
}

function buildChip(profile, state, handlers) {
  const chip = document.createElement('div');
  chip.className = 'prof-chip is-active';
  const visible = !state.hiddenProfiles.has(profile.slug);
  if (!visible) chip.classList.add('is-hidden');

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'prof-chip-main';

  const dot = document.createElement('span');
  dot.className = 'prof-dot';
  dot.style.background = profile.color || '#56d4b8';

  const name = document.createElement('span');
  name.className = 'prof-name';
  name.textContent = profile.shortTitle || profile.label || profile.slug;

  main.append(dot, name);
  main.addEventListener('click', () => {
    handlers.onChange((next) => {
      const set = new Set(next.hiddenProfiles);
      if (set.has(profile.slug)) set.delete(profile.slug); else set.add(profile.slug);
      next.hiddenProfiles = set;
    });
  });

  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'prof-chip-icon';
  eye.title = visible ? 'Masquer' : 'Afficher';
  eye.setAttribute('aria-label', eye.title);
  const eyeIcon = document.createElement('i');
  eyeIcon.className = visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
  eye.appendChild(eyeIcon);
  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onChange((next) => {
      const set = new Set(next.hiddenProfiles);
      if (set.has(profile.slug)) set.delete(profile.slug); else set.add(profile.slug);
      next.hiddenProfiles = set;
    });
  });

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'prof-chip-icon';
  edit.title = 'Éditer';
  edit.setAttribute('aria-label', 'Éditer');
  const editIcon = document.createElement('i');
  editIcon.className = 'fa-solid fa-pen';
  edit.appendChild(editIcon);
  edit.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onEditProfile && handlers.onEditProfile(profile.slug);
  });

  chip.append(main, eye, edit);
  return chip;
}

export function renderQuickSorts({ listings, statusCountListings }, state, handlers) {
  const actionsEl = document.getElementById('quick-sort-actions');
  const recencyEl = document.getElementById('quick-sort-recency');
  if (!actionsEl || !recencyEl) return;

  const counts = countByStatus(statusCountListings || listings);
  actionsEl.replaceChildren();
  for (const def of STATUS_DEFS) {
    actionsEl.appendChild(buildStatusButton(def, state, handlers, counts.get(def.key) || 0));
  }

  recencyEl.replaceChildren();
  for (const opt of RECENCY_OPTS) {
    recencyEl.appendChild(buildRecencyPill(opt, state, handlers));
  }
}

function buildStatusButton(def, state, handlers, count) {
  const on = state.statuses.has(def.key);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `qa-btn tone-${def.tone} ${on ? 'is-on' : 'is-off'}`;
  btn.title = (on ? 'Masquer' : 'Afficher') + ' · ' + def.hint;

  const icon = document.createElement('span');
  icon.className = 'qa-icon';
  const i = document.createElement('i');
  i.className = def.iconClass;
  icon.appendChild(i);

  const text = document.createElement('span');
  text.className = 'qa-text';
  const label = document.createElement('span');
  label.className = 'qa-label';
  label.textContent = def.label;
  const hint = document.createElement('span');
  hint.className = 'qa-hint';
  hint.textContent = def.hint;
  text.append(label, hint);

  const countEl = document.createElement('span');
  countEl.className = 'qa-count';
  countEl.textContent = String(count);

  btn.append(icon, text, countEl);
  btn.addEventListener('click', () => {
    handlers.onChange((next) => {
      const set = new Set(next.statuses);
      if (set.has(def.key)) set.delete(def.key); else set.add(def.key);
      next.statuses = set;
    });
  });
  return btn;
}

function buildRecencyPill(opt, state, handlers) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qs-rec-pill' + (state.recent === opt.v ? ' is-on' : '');
  btn.textContent = opt.l;
  btn.addEventListener('click', () => {
    handlers.onChange((next) => { next.recent = opt.v; });
  });
  return btn;
}

function countByStatus(listings) {
  const m = new Map();
  for (const l of listings || []) {
    if (!l.status) continue;
    m.set(l.status, (m.get(l.status) || 0) + 1);
  }
  return m;
}

export function setPanelsVisible(visible) {
  const filters = document.getElementById('filters-panel');
  const quick = document.getElementById('quick-sorts-panel');
  for (const el of [filters, quick]) {
    if (!el) continue;
    el.classList.toggle('hidden', !visible);
  }
}
