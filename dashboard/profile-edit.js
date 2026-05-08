// Floating profile-edit mode: left settings card + right zones card.
// Replaces the in-drawer editor for the design's two-panel layout.

const PROFILE_PALETTE = [
  '#16a34a', '#db2777', '#2563eb', '#f59e0b',
  '#7c3aed', '#0891b2', '#dc2626', '#56d4b8'
];

const SOURCE_DEFS = [
  { id: 'pe-s-immobilier',  key: 'immobilier',        label: 'Immobilier.ch',                   defaultOn: true  },
  { id: 'pe-s-flatfox',     key: 'flatfox',           label: 'Flatfox',                         defaultOn: true  },
  { id: 'pe-s-naef',        key: 'naef',              label: 'Naef',                            defaultOn: true  },
  { id: 'pe-s-bernard',     key: 'bernardNicod',      label: 'Bernard Nicod',                   defaultOn: true  },
  { id: 'pe-s-rp-listings', key: 'retraitesListings', label: 'Retraites Populaires (locations)', defaultOn: true  },
  { id: 'pe-s-rp-projects', key: 'retraitesProjets',  label: 'Retraites Populaires (projets)',  defaultOn: true  },
  { id: 'pe-s-anibis',      key: 'anibis',            label: 'Anibis',                          defaultOn: false }
];

const CANTON_MAP = {
  ag: 'aargau', ai: 'appenzell-innerrhoden', ar: 'appenzell-ausserrhoden',
  be: 'bern', bl: 'basel-landschaft', bs: 'basel-stadt',
  fr: 'fribourg', ge: 'geneve', gl: 'glarus', gr: 'graubunden',
  ju: 'jura', lu: 'luzern', ne: 'neuchatel', nw: 'nidwalden',
  ow: 'obwalden', sg: 'st-gallen', sh: 'schaffhausen', so: 'solothurn',
  sz: 'schwyz', tg: 'thurgau', ti: 'ticino', ur: 'uri',
  vd: 'vaud', vs: 'valais', zg: 'zug', zh: 'zurich'
};

let leftEl = null;
let rightEl = null;
let editingState = null;     // { profile, color, hasUnsavedChanges }
let mapHandlers = null;
let lifecycleHandlers = null;

export function initProfileEdit({ map, onStarted, onSaved, onClosed, onDirtyChange } = {}) {
  leftEl = document.getElementById('edit-panel-left');
  rightEl = document.getElementById('edit-panel-right');
  mapHandlers = map || {};
  lifecycleHandlers = { onStarted, onSaved, onClosed, onDirtyChange };
}

export function isEditing() {
  return editingState != null;
}

export function getEditingSlug() {
  return editingState ? editingState.profile.slug : null;
}

export async function enterEditMode(slug) {
  let profile = null;
  if (slug) {
    try {
      const res = await fetch('/api/profile/detail?profile=' + encodeURIComponent(slug));
      const json = await res.json();
      profile = json.profile || null;
    } catch {
      profile = null;
    }
    if (!profile) {
      alert('Profil introuvable');
      return;
    }
  } else {
    profile = newDraftProfile();
  }

  editingState = {
    profile,
    color: profile.color || pickColorForSlug(profile.slug || ''),
    isNew: !slug
  };

  document.body && document.body.classList.add('is-editing');
  const shell = document.getElementById('app-shell');
  if (shell) shell.classList.add('is-editing');
  const badge = document.getElementById('edit-mode-badge');
  if (badge) badge.classList.remove('hidden');

  // Notify the app so it can hide the non-edit panels (filters, listings, bottom bar).
  if (lifecycleHandlers && lifecycleHandlers.onStarted) lifecycleHandlers.onStarted();

  renderLeft();
  renderRight();
  showPanels(true);

  if (mapHandlers.onEditStart) {
    await mapHandlers.onEditStart({
      profile: editingState.profile,
      color: editingState.color,
      onCommuneToggle: handleCommuneToggle,
      onCommuneHover: handleCommuneHover,
      onCommuneSelectMany: handleCommuneSelectMany
    });
  }
}

function handleCommuneSelectMany(zones) {
  applyDrawnZones(zones);
}

export async function exitEditMode({ reason } = {}) {
  if (!editingState) return;
  editingState = null;
  showPanels(false);

  document.body && document.body.classList.remove('is-editing');
  const shell = document.getElementById('app-shell');
  if (shell) shell.classList.remove('is-editing');
  const badge = document.getElementById('edit-mode-badge');
  if (badge) badge.classList.add('hidden');

  if (mapHandlers.onEditEnd) await mapHandlers.onEditEnd();
  if (lifecycleHandlers && lifecycleHandlers.onClosed) lifecycleHandlers.onClosed({ reason });
}

function showPanels(visible) {
  if (leftEl) leftEl.classList.toggle('hidden', !visible);
  if (rightEl) rightEl.classList.toggle('hidden', !visible);
}

function newDraftProfile() {
  return {
    slug: '',
    shortTitle: '',
    color: pickColorForSlug(''),
    areas: [],
    sources: Object.fromEntries(SOURCE_DEFS.map((s) => [s.key, s.defaultOn])),
    filters: {
      minTotalChf: 0,
      maxTotalChf: 1400,
      minRoomsPreferred: 2,
      minSurfaceM2Preferred: 0,
      maxPublishedAgeDays: 30,
      allowMissingSurface: true
    },
    preferences: { workplaceAddress: '' }
  };
}

function pickColorForSlug(slug) {
  const text = String(slug || '').toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return PROFILE_PALETTE[hash % PROFILE_PALETTE.length];
}

function update(mutator) {
  const next = { ...editingState.profile };
  mutator(next);
  editingState.profile = next;
  if (lifecycleHandlers && lifecycleHandlers.onDirtyChange) lifecycleHandlers.onDirtyChange(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Left settings panel
// ─────────────────────────────────────────────────────────────────────────────

function renderLeft() {
  if (!leftEl) return;
  leftEl.replaceChildren();

  const profile = editingState.profile;

  // Head
  const head = document.createElement('div');
  head.className = 'ep-head';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'link-btn';
  back.textContent = '← Retour';
  back.addEventListener('click', () => exitEditMode({ reason: 'cancel' }));
  head.appendChild(back);

  const title = document.createElement('div');
  title.className = 'ep-head-title';
  const dot = document.createElement('span');
  dot.className = 'prof-dot';
  dot.style.background = editingState.color;
  const titleText = document.createElement('span');
  const editingLabel = document.createTextNode(' Édition · ');
  const titleStrong = document.createElement('b');
  titleStrong.textContent = profile.shortTitle || 'Sans nom';
  titleText.append(editingLabel, titleStrong);
  title.append(dot, titleText);
  head.appendChild(title);

  leftEl.appendChild(head);

  // Title
  const nameSection = section('Nom du profil');
  const nameInput = document.createElement('input');
  nameInput.className = 'text-input';
  nameInput.value = profile.shortTitle || '';
  nameInput.addEventListener('input', () => {
    update((p) => { p.shortTitle = nameInput.value; });
    titleStrong.textContent = nameInput.value || 'Sans nom';
  });
  nameSection.appendChild(nameInput);
  leftEl.appendChild(nameSection);

  // Color
  const colorSection = section('Couleur');
  const colorRow = document.createElement('div');
  colorRow.className = 'color-row';
  for (const c of PROFILE_PALETTE) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'color-swatch' + (editingState.color === c ? ' is-on' : '');
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => {
      editingState.color = c;
      update((p) => { p.color = c; });
      // Re-render visuals that depend on color
      renderLeft();
      renderRight();
      if (mapHandlers.onColorChange) mapHandlers.onColorChange(c);
    });
    colorRow.appendChild(sw);
  }
  colorSection.appendChild(colorRow);
  leftEl.appendChild(colorSection);

  // Budget
  const budgetSection = section('', 'panel-section grid-2');
  budgetSection.appendChild(numberField('Budget min (CHF)', profile.filters?.minTotalChf ?? 0, (v) => {
    update((p) => { p.filters = { ...p.filters, minTotalChf: v }; });
  }));
  budgetSection.appendChild(numberField('Budget max (CHF)', profile.filters?.maxTotalChf ?? 1400, (v) => {
    update((p) => { p.filters = { ...p.filters, maxTotalChf: v }; });
  }));
  leftEl.appendChild(budgetSection);

  // Rooms / surface
  const roomSection = section('', 'panel-section grid-2');
  roomSection.appendChild(numberField('Pièces (min)', profile.filters?.minRoomsPreferred ?? 2, (v) => {
    update((p) => { p.filters = { ...p.filters, minRoomsPreferred: v }; });
  }, { step: 0.5 }));
  roomSection.appendChild(numberField('Surface min (m²)', profile.filters?.minSurfaceM2Preferred ?? 0, (v) => {
    update((p) => { p.filters = { ...p.filters, minSurfaceM2Preferred: v }; });
  }));
  leftEl.appendChild(roomSection);

  // Age + missing surface
  const ageSection = section('Âge max. annonce (jours)');
  const ageInput = document.createElement('input');
  ageInput.type = 'number';
  ageInput.className = 'text-input';
  ageInput.min = '1';
  ageInput.value = String(profile.filters?.maxPublishedAgeDays ?? 30);
  ageInput.addEventListener('input', () => {
    update((p) => { p.filters = { ...p.filters, maxPublishedAgeDays: Number(ageInput.value) || 30 }; });
  });
  ageSection.appendChild(ageInput);

  const missing = document.createElement('label');
  missing.className = 'checkrow tight';
  const missingInput = document.createElement('input');
  missingInput.type = 'checkbox';
  missingInput.checked = profile.filters?.allowMissingSurface !== false;
  missingInput.addEventListener('change', () => {
    update((p) => { p.filters = { ...p.filters, allowMissingSurface: missingInput.checked }; });
  });
  missing.append(missingInput, textNode('Inclure annonces sans surface'));
  ageSection.appendChild(missing);
  leftEl.appendChild(ageSection);

  // Workplace
  const workSection = section('Lieu de travail');
  const workInput = document.createElement('input');
  workInput.className = 'text-input';
  workInput.placeholder = 'Ex: Rue du Midi 15, Lausanne';
  workInput.value = profile.preferences?.workplaceAddress || '';
  workInput.addEventListener('input', () => {
    update((p) => { p.preferences = { ...p.preferences, workplaceAddress: workInput.value }; });
  });
  workSection.appendChild(workInput);
  leftEl.appendChild(workSection);

  // Sources
  const sourcesSection = section('Sources');
  for (const def of SOURCE_DEFS) {
    const row = document.createElement('label');
    row.className = 'checkrow tight';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const sources = profile.sources || {};
    let on;
    if (def.key === 'anibis') on = !!sources[def.key];
    else on = sources[def.key] !== false;
    cb.checked = on;
    cb.addEventListener('change', () => {
      update((p) => { p.sources = { ...p.sources, [def.key]: cb.checked }; });
    });
    row.append(cb, textNode(def.label));
    sourcesSection.appendChild(row);
  }
  leftEl.appendChild(sourcesSection);

  // Footer (Save / Cancel / Delete)
  const foot = document.createElement('div');
  foot.className = 'ep-foot';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ghost';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => exitEditMode({ reason: 'cancel' }));

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary';
  saveBtn.textContent = editingState.isNew ? 'Créer le profil' : 'Enregistrer';
  saveBtn.addEventListener('click', () => save(saveBtn));

  foot.append(cancelBtn, saveBtn);
  leftEl.appendChild(foot);

  if (!editingState.isNew) {
    const danger = document.createElement('div');
    danger.className = 'panel-section danger';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'link-btn warn';
    del.textContent = 'Supprimer le profil…';
    del.addEventListener('click', deleteProfile);
    danger.appendChild(del);
    leftEl.appendChild(danger);
  }
}

function section(label, className = 'panel-section') {
  const sec = document.createElement('div');
  sec.className = className;
  if (label) {
    const l = document.createElement('label');
    l.className = 'micro-label';
    l.textContent = label;
    sec.appendChild(l);
  }
  return sec;
}

function numberField(label, value, onInput, { step } = {}) {
  const wrap = document.createElement('div');
  const l = document.createElement('label');
  l.className = 'micro-label';
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'text-input';
  input.value = String(value ?? '');
  if (step != null) input.step = String(step);
  input.addEventListener('input', () => {
    const n = Number(input.value);
    onInput(Number.isFinite(n) ? n : 0);
  });
  wrap.append(l, input);
  return wrap;
}

function textNode(text) { return document.createTextNode(text); }

// ─────────────────────────────────────────────────────────────────────────────
// Right zones panel
// ─────────────────────────────────────────────────────────────────────────────

function renderRight() {
  if (!rightEl) return;
  rightEl.replaceChildren();

  const profile = editingState.profile;

  const head = document.createElement('div');
  head.className = 'ep-head';
  const label = document.createElement('span');
  label.className = 'micro-label';
  label.textContent = 'Zones (communes)';
  const count = document.createElement('span');
  count.className = 'ep-count';
  count.textContent = String((profile.areas || []).length);
  head.append(label, count);
  rightEl.appendChild(head);

  const hint = document.createElement('div');
  hint.className = 'zone-hint';
  const hintDot = document.createElement('span');
  hintDot.className = 'hint-dot';
  hintDot.style.background = editingState.color;
  hint.append(hintDot, document.createTextNode('Dessinez une zone sur la carte pour ajouter plusieurs communes d’un coup, ou retirez-en en cliquant un polygone.'));
  rightEl.appendChild(hint);

  // Lasso draw button
  const drawSection = document.createElement('div');
  drawSection.className = 'panel-section';
  const drawBtn = document.createElement('button');
  drawBtn.type = 'button';
  drawBtn.className = 'lasso-btn';
  drawBtn.dataset.role = 'lasso';
  renderLassoButton(drawBtn, editingState.lassoActive === true);
  drawBtn.addEventListener('click', () => {
    if (editingState.lassoActive) {
      if (mapHandlers.onLassoCancel) mapHandlers.onLassoCancel();
    } else {
      if (mapHandlers.onLassoStart) mapHandlers.onLassoStart();
    }
  });
  drawSection.appendChild(drawBtn);
  rightEl.appendChild(drawSection);

  // Search
  const searchSection = section('');
  const wrap = document.createElement('div');
  wrap.className = 'commune-search-wrap';

  const input = document.createElement('input');
  input.className = 'text-input';
  input.placeholder = 'Rechercher une commune…';
  input.autocomplete = 'off';

  const list = document.createElement('div');
  list.className = 'commune-suggest hidden';

  wrap.append(input, list);
  searchSection.appendChild(wrap);
  rightEl.appendChild(searchSection);
  attachAutocomplete(input, list);

  // Selected zones list
  const zonesList = document.createElement('div');
  zonesList.className = 'zones-list';
  if (!profile.areas || profile.areas.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty small';
    empty.textContent = 'Aucune zone — sélectionnez des communes sur la carte ou via la recherche.';
    zonesList.appendChild(empty);
  } else {
    for (const zone of profile.areas) {
      zonesList.appendChild(buildZoneRow(zone));
    }
  }
  rightEl.appendChild(zonesList);
}

function renderLassoButton(btn, isActive) {
  btn.replaceChildren();
  const i = document.createElement('i');
  i.className = isActive ? 'fa-solid fa-xmark' : 'fa-solid fa-draw-polygon';
  btn.classList.toggle('is-active', !!isActive);
  btn.title = isActive ? 'Annuler le tracé' : 'Dessiner une zone';
  btn.append(i, document.createTextNode(isActive ? ' Annuler le tracé' : ' Dessiner une zone'));
}

export function setLassoActive(isActive) {
  if (!editingState) return;
  editingState.lassoActive = !!isActive;
  if (!rightEl) return;
  const btn = rightEl.querySelector('button[data-role="lasso"]');
  if (btn) renderLassoButton(btn, !!isActive);
}

export function applyDrawnZones(zones) {
  if (!editingState) return 0;
  const profile = editingState.profile;
  const existing = profile.areas || [];
  const knownSlugs = new Set(existing.map((z) => z.slug));
  const knownFeatureIds = new Set(existing.filter((z) => z.featureId).map((z) => String(z.featureId)));

  const fresh = [];
  for (const zone of zones) {
    if (!zone || !zone.slug) continue;
    if (knownSlugs.has(zone.slug)) continue;
    if (zone.featureId && knownFeatureIds.has(String(zone.featureId))) continue;
    fresh.push(zone);
    knownSlugs.add(zone.slug);
    if (zone.featureId) knownFeatureIds.add(String(zone.featureId));
  }
  if (fresh.length === 0) return 0;

  update((p) => { p.areas = [...existing, ...fresh]; });
  renderRight();
  if (mapHandlers.onZonesAdded) mapHandlers.onZonesAdded(fresh);
  return fresh.length;
}

function buildZoneRow(zone) {
  const row = document.createElement('div');
  row.className = 'zone-row';
  row.dataset.slug = zone.slug;
  row.addEventListener('mouseenter', () => {
    if (mapHandlers.onCommuneHoverFromList) mapHandlers.onCommuneHoverFromList(zone);
  });
  row.addEventListener('mouseleave', () => {
    if (mapHandlers.onCommuneHoverFromList) mapHandlers.onCommuneHoverFromList(null);
  });

  const bullet = document.createElement('span');
  bullet.className = 'zone-bullet';
  bullet.style.background = editingState.color;

  const name = document.createElement('span');
  name.className = 'zone-name';
  name.textContent = zone.label;

  const canton = document.createElement('span');
  canton.className = 'zone-canton';
  canton.textContent = zone.cantonAbbr || zone.canton || '';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn sm';
  remove.title = 'Retirer';
  remove.setAttribute('aria-label', 'Retirer');
  const removeIcon = document.createElement('i');
  removeIcon.className = 'fa-solid fa-xmark';
  remove.appendChild(removeIcon);
  remove.addEventListener('click', () => removeZone(zone.slug));

  row.append(bullet, name, canton, remove);
  return row;
}

function addZone(zone) {
  const profile = editingState.profile;
  const existing = profile.areas || [];
  if (existing.some((z) => z.slug === zone.slug)) return;
  update((p) => { p.areas = [...existing, zone]; });
  renderRight();
  if (mapHandlers.onZoneAdded) mapHandlers.onZoneAdded(zone);
}

function removeZone(slug) {
  const profile = editingState.profile;
  const removed = (profile.areas || []).find((z) => z.slug === slug);
  update((p) => { p.areas = (p.areas || []).filter((z) => z.slug !== slug); });
  renderRight();
  if (removed && mapHandlers.onZoneRemoved) mapHandlers.onZoneRemoved(removed);
}

function handleCommuneToggle(zone) {
  const profile = editingState.profile;
  const has = (profile.areas || []).some((z) => z.slug === zone.slug);
  if (has) removeZone(zone.slug);
  else addZone(zone);
}

function handleCommuneHover(zone) {
  // No-op for the moment; could highlight matching zone-row
  if (!rightEl) return;
  const rows = rightEl.querySelectorAll('.zone-row');
  rows.forEach((r) => r.classList.remove('is-hovered'));
  if (zone) {
    const escaped = (window.CSS && CSS.escape) ? CSS.escape(zone.slug) : zone.slug;
    const row = rightEl.querySelector('.zone-row[data-slug="' + escaped + '"]');
    if (row) row.classList.add('is-hovered');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geo autocomplete (geo.admin.ch SearchServer)
// ─────────────────────────────────────────────────────────────────────────────

function attachAutocomplete(inputEl, listEl) {
  let abort = null;
  let timer = null;
  let results = [];
  let activeIdx = -1;

  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { listEl.classList.add('hidden'); return; }
    timer = setTimeout(async () => {
      results = await searchGeo(q, abort = new AbortController());
      renderResults();
    }, 250);
  });

  inputEl.addEventListener('keydown', (e) => {
    const items = listEl.querySelectorAll('.commune-suggest-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIdx + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0 && activeIdx < results.length) {
      e.preventDefault();
      pick(results[activeIdx]);
    } else if (e.key === 'Escape') {
      listEl.classList.add('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.commune-search-wrap')) {
      listEl.classList.add('hidden');
    }
  });

  function renderResults() {
    listEl.replaceChildren();
    activeIdx = -1;
    if (!results.length) { listEl.classList.add('hidden'); return; }
    results.forEach((r, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'commune-suggest-item';
      item.dataset.index = String(i);
      const label = document.createElement('span');
      label.textContent = r.label;
      const detail = document.createElement('small');
      detail.textContent = (r.cantonAbbr ? r.cantonAbbr + ' · ' : '') + (r.canton || '');
      item.append(label, detail);
      item.addEventListener('click', () => pick(r));
      item.addEventListener('mouseenter', () => setActive(i));
      listEl.appendChild(item);
    });
    listEl.classList.remove('hidden');
  }

  function setActive(i) {
    const items = listEl.querySelectorAll('.commune-suggest-item');
    items.forEach((el) => el.classList.remove('is-active'));
    activeIdx = i;
    if (i >= 0 && i < items.length) items[i].classList.add('is-active');
  }

  function pick(r) {
    inputEl.value = '';
    listEl.classList.add('hidden');
    addZone(r);
  }
}

async function searchGeo(query, controller) {
  const url = 'https://api3.geo.admin.ch/rest/services/api/SearchServer'
    + '?searchText=' + encodeURIComponent(query)
    + '&type=locations&origins=gg25&limit=8';
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    return (data.results || []).map(parseGeoResult);
  } catch (err) {
    if (err.name === 'AbortError') return [];
    return [];
  }
}

function parseGeoResult(result) {
  const a = result.attrs || {};
  const rawLabel = (a.label || '').replace(/<[^>]+>/g, '').trim();
  const detail = (a.detail || '').toLowerCase();
  const cantonMatch = detail.match(/\b([a-z]{2})$/);
  const cantonAbbr = cantonMatch ? cantonMatch[1] : '';
  const canton = CANTON_MAP[cantonAbbr] || cantonAbbr;
  const cityName = rawLabel.replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();
  return {
    slug: buildSlug(cityName),
    label: cityName,
    canton,
    cantonAbbr: cantonAbbr.toUpperCase(),
    lat: a.lat,
    lon: a.lon,
    featureId: a.featureId || a.id || null
  };
}

function buildSlug(label) {
  return String(label || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Save / delete
// ─────────────────────────────────────────────────────────────────────────────

async function save(saveBtn) {
  if (!editingState) return;
  const profile = editingState.profile;
  const shortTitle = (profile.shortTitle || '').trim();
  if (!shortTitle) { alert('Titre requis'); return; }
  if (!profile.areas || profile.areas.length === 0) { alert('Ajoutez au moins une zone'); return; }

  const isCreate = editingState.isNew;
  const payload = buildPayload(editingState, shortTitle, isCreate);

  saveBtn.disabled = true;
  const previousLabel = saveBtn.textContent;
  saveBtn.textContent = '…';

  try {
    const url = isCreate ? '/api/profile/create' : '/api/profile/update';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      alert('Erreur : ' + (json.error || res.statusText));
      return;
    }
    if (lifecycleHandlers && lifecycleHandlers.onSaved) {
      await lifecycleHandlers.onSaved({ slug: payload.slug, isNew: isCreate });
    }
    await exitEditMode({ reason: 'saved' });
  } catch (err) {
    alert('Erreur réseau : ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = previousLabel;
  }
}

async function deleteProfile() {
  if (!editingState || editingState.isNew) return;
  const profile = editingState.profile;
  if (!confirm('Supprimer le profil "' + (profile.shortTitle || profile.slug) + '" et toutes ses données ?')) return;
  try {
    const res = await fetch('/api/profile/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: profile.slug })
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      alert('Erreur : ' + (json.error || res.statusText));
      return;
    }
    if (lifecycleHandlers && lifecycleHandlers.onSaved) {
      await lifecycleHandlers.onSaved({ slug: profile.slug, deleted: true });
    }
    await exitEditMode({ reason: 'deleted' });
  } catch (err) {
    alert('Erreur réseau : ' + err.message);
  }
}

function buildPayload(state, shortTitle, isCreate) {
  const profile = state.profile;
  const slug = isCreate ? buildSlug(shortTitle) : profile.slug;
  const areas = (profile.areas || []).map((z) => ({
    slug: z.slug,
    label: z.label,
    canton: z.canton,
    lat: z.lat,
    lon: z.lon
  }));
  return {
    slug,
    shortTitle,
    color: state.color,
    areas,
    sources: { ...(profile.sources || {}) },
    filters: { ...(profile.filters || {}) },
    preferences: { ...(profile.preferences || {}) }
  };
}
