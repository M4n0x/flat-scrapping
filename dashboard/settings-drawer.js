// dashboard/settings-drawer.js
// Settings drawer: profile list + per-profile editor form.
// Ported from dashboard/home.js — same fields, same payload shape, same autocomplete helpers.

let drawerEl = null;
let onProfilesChangedHandler = () => {};

// --- Canton mapping (ported verbatim from home.js) ---

const CANTON_MAP = {
  ag: 'aargau', ai: 'appenzell-innerrhoden', ar: 'appenzell-ausserrhoden',
  be: 'bern', bl: 'basel-landschaft', bs: 'basel-stadt',
  fr: 'fribourg', ge: 'geneve', gl: 'glarus', gr: 'graubunden',
  ju: 'jura', lu: 'luzern', ne: 'neuchatel', nw: 'nidwalden',
  ow: 'obwalden', sg: 'st-gallen', sh: 'schaffhausen', so: 'solothurn',
  sz: 'schwyz', tg: 'thurgau', ti: 'ticino', ur: 'uri',
  vd: 'vaud', vs: 'valais', zg: 'zug', zh: 'zurich'
};

// --- Helpers ---

function buildSlug(label) {
  return label
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseGeoResult(result) {
  const a = result.attrs;
  const rawLabel = (a.label || '').replace(/<[^>]+>/g, '').trim();
  const detail = (a.detail || '').toLowerCase();

  const cantonMatch = detail.match(/\b([a-z]{2})$/);
  const cantonAbbr = cantonMatch ? cantonMatch[1] : '';
  const canton = CANTON_MAP[cantonAbbr] || cantonAbbr;

  const cityName = rawLabel.replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();

  return {
    label: cityName,
    slug: buildSlug(cityName),
    canton,
    cantonAbbr: cantonAbbr.toUpperCase(),
    lat: a.lat,
    lon: a.lon
  };
}

function isTypingInForm(target) {
  return target && /input|textarea|select/i.test(target.tagName);
}

// --- Generic geo.admin.ch autocomplete (ported from home.js; DOM built imperatively) ---

function createGeoAutocomplete({ inputEl, listEl, origins, renderItemDom, onSelect, minChars = 2 }) {
  let abort = null;
  let timer = null;
  let results = [];
  let idx = -1;

  async function search(query) {
    if (abort) abort.abort();
    const controller = new AbortController();
    abort = controller;
    const originsParam = origins ? ('&origins=' + origins) : '';
    const url = 'https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText='
      + encodeURIComponent(query) + '&type=locations' + originsParam + '&limit=8';
    try {
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      return (data.results || []).map(parseGeoResult);
    } catch (err) {
      if (err.name === 'AbortError') return [];
      return [];
    }
  }

  function render(items) {
    listEl.replaceChildren();
    idx = -1;
    results = items;
    if (!items.length) { listEl.classList.add('hidden'); return; }
    for (let i = 0; i < items.length; i++) {
      const li = document.createElement('li');
      li.dataset.index = String(i);
      renderItemDom(li, items[i]);
      li.addEventListener('click', () => { onSelect(items[i]); listEl.classList.add('hidden'); });
      li.addEventListener('mouseenter', () => setActive(i));
      listEl.appendChild(li);
    }
    listEl.classList.remove('hidden');
  }

  function setActive(i) {
    const lis = listEl.querySelectorAll('li');
    lis.forEach((el) => el.classList.remove('active'));
    idx = i;
    if (i >= 0 && i < lis.length) {
      lis[i].classList.add('active');
      lis[i].scrollIntoView({ block: 'nearest' });
    }
  }

  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    clearTimeout(timer);
    if (q.length < minChars) { listEl.classList.add('hidden'); return; }
    timer = setTimeout(async () => { render(await search(q)); }, 250);
  });

  inputEl.addEventListener('keydown', (e) => {
    const lis = listEl.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setActive(Math.min(idx + 1, lis.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActive(Math.max(idx - 1, 0));
    } else if (e.key === 'Enter' && idx >= 0 && idx < results.length) {
      e.preventDefault(); onSelect(results[idx]); listEl.classList.add('hidden');
    } else if (e.key === 'Escape') {
      listEl.classList.add('hidden');
    }
  });
}

// --- DOM builder utility ---

function makeFieldGroup(labelText) {
  const group = document.createElement('div');
  group.className = 'field-group';
  if (labelText) {
    const lbl = document.createElement('label');
    lbl.className = 'field-label';
    lbl.textContent = labelText;
    group.appendChild(lbl);
  }
  return group;
}

// --- Public API ---

export function initDrawer({ onProfilesChanged } = {}) {
  drawerEl = document.getElementById('settings-drawer');
  onProfilesChangedHandler = (typeof onProfilesChanged === 'function') ? onProfilesChanged : () => {};

  // Dismiss handlers: overlay click + close button(s)
  drawerEl.querySelectorAll('[data-drawer-close]').forEach((el) => {
    el.addEventListener('click', closeDrawer);
  });

  // Keyboard handlers — attached once here, never per-render
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerEl && !drawerEl.classList.contains('hidden')) {
      // Only close if no open suggestion dropdown is visible inside the drawer
      const openSuggestions = drawerEl.querySelector('.zone-suggestions:not(.hidden)');
      if (openSuggestions) return;
      closeDrawer();
    } else if (e.key === ',' && !isTypingInForm(e.target)) {
      openDrawer();
    }
  });

  // Outside-click closes suggestion dropdowns
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.zone-autocomplete-wrap')) {
      document.querySelectorAll('.zone-suggestions').forEach((el) => el.classList.add('hidden'));
    }
  });

  const settingsBtn = document.getElementById('settings-button');
  if (settingsBtn) settingsBtn.addEventListener('click', () => openDrawer());
}

export async function openDrawer(opts) {
  if (!drawerEl) return;
  drawerEl.classList.remove('hidden');
  const slug = opts && opts.slug ? opts.slug : null;
  if (slug) await renderEditor(slug);
  else await renderList();
}

export function closeDrawer() {
  if (!drawerEl) return;
  drawerEl.classList.add('hidden');
}

// --- List view ---

async function renderList() {
  const body = document.getElementById('drawer-body');
  if (!body) return;
  body.replaceChildren();

  const newButton = document.createElement('button');
  newButton.id = 'drawer-new-profile';
  newButton.className = 'btn btn-primary btn-sm';
  newButton.type = 'button';
  newButton.textContent = 'Nouveau profil';
  newButton.addEventListener('click', () => renderEditor(null));
  body.appendChild(newButton);

  const listEl = document.createElement('div');
  listEl.id = 'drawer-profile-list';
  body.appendChild(listEl);

  let profiles = [];
  try {
    const res = await fetch('/api/profiles');
    const json = await res.json();
    profiles = json.profiles || [];
  } catch {
    profiles = [];
  }

  if (profiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'drawer-empty';
    empty.textContent = 'Aucun profil. Créez le premier.';
    listEl.appendChild(empty);
    return;
  }

  for (const p of profiles) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'drawer-profile-row';
    row.dataset.slug = p.slug;

    const dot = document.createElement('span');
    dot.className = 'profile-dot';
    dot.style.background = p.color || '#56d4b8';

    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = p.shortTitle || p.label || p.slug;

    const meta = document.createElement('span');
    meta.className = 'profile-meta';
    const zoneCount = Array.isArray(p.areas) ? p.areas.length : 0;
    meta.textContent = zoneCount + ' zone' + (zoneCount === 1 ? '' : 's');

    const chev = document.createElement('span');
    chev.className = 'chevron';
    const chevIcon = document.createElement('i');
    chevIcon.className = 'fa-solid fa-chevron-right';
    chev.appendChild(chevIcon);

    row.append(dot, name, meta, chev);
    row.addEventListener('click', () => renderEditor(row.dataset.slug));
    listEl.appendChild(row);
  }
}

// --- Editor view ---

async function renderEditor(slug) {
  const body = document.getElementById('drawer-body');
  if (!body) return;
  body.replaceChildren();

  let profile = null;
  if (slug) {
    try {
      const res = await fetch('/api/profile/detail?profile=' + encodeURIComponent(slug));
      const json = await res.json();
      profile = json.profile || null;
    } catch { profile = null; }
  }

  // Back button
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'editor-back btn btn-ghost btn-sm';
  const backIcon = document.createElement('i');
  backIcon.className = 'fa-solid fa-arrow-left';
  back.append(backIcon, document.createTextNode(' Retour'));
  back.addEventListener('click', renderList);
  body.appendChild(back);

  // Per-editor mutable zone state (isolated from any other editor instance)
  let editorZones = profile ? [...(profile.areas || [])] : [];

  // Form
  const form = document.createElement('form');
  form.id = 'drawer-editor-form';
  form.className = 'editor-form';
  form.noValidate = true;

  // ── Title (shortTitle) ──────────────────────────────────────────────────

  const titleGroup = makeFieldGroup('Nom du profil');
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.id = 'editor-f-title';
  titleInput.name = 'shortTitle';
  titleInput.className = 'input';
  titleInput.placeholder = 'Ex: Lausanne 3p';
  titleInput.required = true;
  titleInput.value = profile ? (profile.shortTitle || profile.label || '') : '';
  titleGroup.appendChild(titleInput);
  form.appendChild(titleGroup);

  // ── Zones autocomplete ──────────────────────────────────────────────────

  const zonesGroup = makeFieldGroup('Zones (communes)');

  const zonesList = document.createElement('div');
  zonesList.id = 'editor-zones-list';
  zonesList.className = 'zones-list';

  const zoneWrap = document.createElement('div');
  zoneWrap.className = 'zone-autocomplete-wrap';

  const zoneSearch = document.createElement('input');
  zoneSearch.type = 'text';
  zoneSearch.id = 'editor-zone-search';
  zoneSearch.className = 'input';
  zoneSearch.placeholder = 'Rechercher une commune…';
  zoneSearch.autocomplete = 'off';

  const zoneSuggestions = document.createElement('ul');
  zoneSuggestions.id = 'editor-zone-suggestions';
  zoneSuggestions.className = 'zone-suggestions hidden';

  zoneWrap.append(zoneSearch, zoneSuggestions);
  zonesGroup.append(zonesList, zoneWrap);
  form.appendChild(zonesGroup);

  function renderEditorZones() {
    zonesList.replaceChildren();
    if (!editorZones.length) {
      const hint = document.createElement('span');
      hint.className = 'zones-empty-hint';
      hint.style.cssText = 'color:var(--muted);font-size:0.82rem';
      hint.textContent = 'Aucune zone ajoutée — recherchez une commune ci-dessous';
      zonesList.appendChild(hint);
      return;
    }
    for (const z of editorZones) {
      const chip = document.createElement('span');
      chip.className = 'zone-chip';

      const labelNode = document.createTextNode(z.label);
      chip.appendChild(labelNode);

      if (z.canton) {
        const small = document.createElement('small');
        small.style.opacity = '0.6';
        small.textContent = ' ' + z.canton;
        chip.appendChild(small);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-zone';
      removeBtn.title = 'Retirer';
      const removeIcon = document.createElement('i');
      removeIcon.className = 'fa-solid fa-xmark';
      removeBtn.appendChild(removeIcon);
      const zSlug = z.slug;
      removeBtn.addEventListener('click', () => {
        editorZones = editorZones.filter((x) => x.slug !== zSlug);
        renderEditorZones();
      });
      chip.appendChild(removeBtn);
      zonesList.appendChild(chip);
    }
  }

  renderEditorZones();

  createGeoAutocomplete({
    inputEl: zoneSearch,
    listEl: zoneSuggestions,
    origins: 'gg25',
    renderItemDom: (li, r) => {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'suggestion-label';
      labelSpan.textContent = r.label;
      const detailSpan = document.createElement('span');
      detailSpan.className = 'suggestion-detail';
      detailSpan.textContent = r.cantonAbbr + ' · ' + r.canton;
      li.append(labelSpan, detailSpan);
    },
    onSelect: (r) => {
      if (editorZones.some((z) => z.slug === r.slug)) { zoneSearch.value = ''; return; }
      editorZones.push({ slug: r.slug, label: r.label, canton: r.canton, lat: r.lat, lon: r.lon });
      zoneSearch.value = '';
      renderEditorZones();
    }
  });

  // ── Budget ──────────────────────────────────────────────────────────────

  const budgetGroup = makeFieldGroup('Budget (CHF/mois)');
  const budgetRow = document.createElement('div');
  budgetRow.className = 'field-row';

  const minRentInput = document.createElement('input');
  minRentInput.type = 'number';
  minRentInput.id = 'editor-f-min-rent';
  minRentInput.name = 'minTotalChf';
  minRentInput.className = 'input';
  minRentInput.placeholder = 'Min';
  minRentInput.min = '0';
  minRentInput.value = String(
    profile ? (profile.filters?.minTotalChf ?? profile.minRent ?? 0) : 0
  );

  const sep = document.createElement('span');
  sep.className = 'field-sep';
  sep.textContent = '–';

  const maxRentInput = document.createElement('input');
  maxRentInput.type = 'number';
  maxRentInput.id = 'editor-f-max-rent';
  maxRentInput.name = 'maxTotalChf';
  maxRentInput.className = 'input';
  maxRentInput.placeholder = 'Max';
  maxRentInput.min = '0';
  maxRentInput.value = String(
    profile ? (profile.filters?.maxTotalChf ?? profile.maxRent ?? 1400) : 1400
  );

  budgetRow.append(minRentInput, sep, maxRentInput);
  budgetGroup.appendChild(budgetRow);
  form.appendChild(budgetGroup);

  // ── Rooms ───────────────────────────────────────────────────────────────

  const roomsGroup = makeFieldGroup('Pièces (minimum souhaité)');
  const roomsInput = document.createElement('input');
  roomsInput.type = 'number';
  roomsInput.id = 'editor-f-min-rooms';
  roomsInput.name = 'minRoomsPreferred';
  roomsInput.className = 'input';
  roomsInput.min = '1';
  roomsInput.step = '0.5';
  roomsInput.value = String(
    profile ? (profile.filters?.minRoomsPreferred ?? profile.minRooms ?? 2) : 2
  );
  roomsGroup.appendChild(roomsInput);
  form.appendChild(roomsGroup);

  // ── Surface ─────────────────────────────────────────────────────────────

  const surfaceGroup = makeFieldGroup('Surface min. (m²)');
  const surfaceInput = document.createElement('input');
  surfaceInput.type = 'number';
  surfaceInput.id = 'editor-f-min-surface';
  surfaceInput.name = 'minSurfaceM2Preferred';
  surfaceInput.className = 'input';
  surfaceInput.min = '0';
  surfaceInput.value = String(
    profile ? (profile.filters?.minSurfaceM2Preferred ?? 0) : 0
  );
  surfaceGroup.appendChild(surfaceInput);
  form.appendChild(surfaceGroup);

  // ── Max published age ───────────────────────────────────────────────────

  const maxAgeGroup = makeFieldGroup('Âge max. annonce (jours)');
  const maxAgeInput = document.createElement('input');
  maxAgeInput.type = 'number';
  maxAgeInput.id = 'editor-f-max-age';
  maxAgeInput.name = 'maxPublishedAgeDays';
  maxAgeInput.className = 'input';
  maxAgeInput.min = '1';
  maxAgeInput.value = String(
    profile ? (profile.filters?.maxPublishedAgeDays ?? 30) : 30
  );
  maxAgeGroup.appendChild(maxAgeInput);
  form.appendChild(maxAgeGroup);

  // ── Allow missing surface ───────────────────────────────────────────────

  const allowSurfaceGroup = makeFieldGroup('');
  const allowSurfaceLabel = document.createElement('label');
  allowSurfaceLabel.className = 'checkbox';
  const allowSurfaceCheck = document.createElement('input');
  allowSurfaceCheck.type = 'checkbox';
  allowSurfaceCheck.id = 'editor-f-allow-missing-surface';
  allowSurfaceCheck.name = 'allowMissingSurface';
  allowSurfaceCheck.checked = profile ? (profile.filters?.allowMissingSurface !== false) : true;
  const allowSurfaceText = document.createTextNode(' Inclure annonces sans surface');
  allowSurfaceLabel.append(allowSurfaceCheck, allowSurfaceText);
  allowSurfaceGroup.appendChild(allowSurfaceLabel);
  form.appendChild(allowSurfaceGroup);

  // ── Workplace autocomplete ──────────────────────────────────────────────

  const workplaceGroup = makeFieldGroup('Adresse du lieu de travail');

  const workplaceWrap = document.createElement('div');
  workplaceWrap.className = 'zone-autocomplete-wrap';

  const workplaceInput = document.createElement('input');
  workplaceInput.type = 'text';
  workplaceInput.id = 'editor-f-workplace';
  workplaceInput.name = 'workplaceAddress';
  workplaceInput.className = 'input';
  workplaceInput.placeholder = 'Ex: Rue du Midi 15, Lausanne';
  workplaceInput.autocomplete = 'off';
  workplaceInput.value = profile ? (profile.preferences?.workplaceAddress ?? '') : '';

  const workplaceSuggestions = document.createElement('ul');
  workplaceSuggestions.id = 'editor-workplace-suggestions';
  workplaceSuggestions.className = 'zone-suggestions hidden';

  workplaceWrap.append(workplaceInput, workplaceSuggestions);
  workplaceGroup.appendChild(workplaceWrap);
  form.appendChild(workplaceGroup);

  createGeoAutocomplete({
    inputEl: workplaceInput,
    listEl: workplaceSuggestions,
    origins: null,
    renderItemDom: (li, r) => {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'suggestion-label';
      labelSpan.textContent = r.label;
      li.appendChild(labelSpan);
    },
    onSelect: (r) => { workplaceInput.value = r.label; },
    minChars: 3
  });

  // Prevent Enter from triggering form submit while suggestion list is visible
  workplaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !workplaceSuggestions.classList.contains('hidden')) {
      e.preventDefault();
    }
  });

  // ── Sources ─────────────────────────────────────────────────────────────

  const sourcesGroup = makeFieldGroup('Sources');
  const sourceDefs = [
    { id: 'editor-s-immobilier',  key: 'immobilier',        label: 'Immobilier.ch',                   defaultOn: true  },
    { id: 'editor-s-flatfox',     key: 'flatfox',           label: 'Flatfox',                         defaultOn: true  },
    { id: 'editor-s-naef',        key: 'naef',              label: 'Naef',                            defaultOn: true  },
    { id: 'editor-s-bernard',     key: 'bernardNicod',      label: 'Bernard Nicod',                   defaultOn: true  },
    { id: 'editor-s-rp-listings', key: 'retraitesListings', label: 'Retraites Populaires (listings)', defaultOn: true  },
    { id: 'editor-s-rp-projects', key: 'retraitesProjets',  label: 'Retraites Populaires (projets)',  defaultOn: true  },
    { id: 'editor-s-anibis',      key: 'anibis',            label: 'Anibis',                          defaultOn: false }
  ];
  for (const def of sourceDefs) {
    const lbl = document.createElement('label');
    lbl.className = 'checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = def.id;
    let checked;
    if (profile) {
      checked = def.key === 'anibis' ? !!profile.sources?.[def.key] : profile.sources?.[def.key] !== false;
    } else {
      checked = def.defaultOn;
    }
    cb.checked = checked;
    const txt = document.createTextNode(' ' + def.label);
    lbl.append(cb, txt);
    sourcesGroup.appendChild(lbl);
  }
  form.appendChild(sourcesGroup);

  body.appendChild(form);

  // ── Footer: Save / Delete / Cancel ─────────────────────────────────────

  const foot = document.createElement('footer');
  foot.className = 'editor-foot';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = profile ? 'Enregistrer' : 'Créer le profil';
  saveBtn.form = form.id;

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', renderList);

  foot.append(saveBtn, cancelBtn);

  if (profile) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-destructive editor-delete';
    const trashIcon = document.createElement('i');
    trashIcon.className = 'fa-solid fa-trash';
    delBtn.append(trashIcon, document.createTextNode(' Supprimer'));
    delBtn.addEventListener('click', () => onDelete(profile.slug));
    foot.appendChild(delBtn);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit(profile, form, editorZones, saveBtn);
  });

  body.appendChild(foot);
}

// --- Form submission ---

async function onSubmit(profile, form, editorZones, submitBtn) {
  const shortTitle = form.querySelector('#editor-f-title')?.value.trim() || '';
  if (!shortTitle) { alert('Titre requis'); return; }
  if (!editorZones.length) { alert('Ajoutez au moins une zone'); return; }

  const payload = collectFormValues(profile, form, editorZones);

  submitBtn.disabled = true;
  submitBtn.textContent = '…';

  const url = profile ? '/api/profile/update' : '/api/profile/create';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      alert('Erreur: ' + (json.error || res.statusText));
      return;
    }
    onProfilesChangedHandler();
    await renderList();
  } catch (err) {
    alert('Erreur réseau: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = profile ? 'Enregistrer' : 'Créer le profil';
  }
}

// --- Delete ---

async function onDelete(slug) {
  if (!confirm('Supprimer le profil "' + slug + '" et toutes ses données ?\n\nCette action est irréversible.')) return;
  try {
    const res = await fetch('/api/profile/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug })
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      alert('Erreur: ' + (json.error || res.statusText));
      return;
    }
    onProfilesChangedHandler();
    await renderList();
  } catch (err) {
    alert('Erreur réseau: ' + err.message);
  }
}

// --- Payload builder (mirrors home.js submit handler exactly) ---

function collectFormValues(profile, form, editorZones) {
  const shortTitle = form.querySelector('#editor-f-title')?.value.trim() || '';

  const isEdit = !!profile;
  const slug = isEdit
    ? profile.slug
    : shortTitle.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+$/g, '');

  return {
    slug,
    shortTitle,
    areas: editorZones,
    sources: {
      immobilier:        !!(form.querySelector('#editor-s-immobilier')?.checked),
      flatfox:           !!(form.querySelector('#editor-s-flatfox')?.checked),
      naef:              !!(form.querySelector('#editor-s-naef')?.checked),
      bernardNicod:      !!(form.querySelector('#editor-s-bernard')?.checked),
      retraitesListings: !!(form.querySelector('#editor-s-rp-listings')?.checked),
      retraitesProjets:  !!(form.querySelector('#editor-s-rp-projects')?.checked),
      anibis:            !!(form.querySelector('#editor-s-anibis')?.checked)
    },
    filters: {
      minTotalChf:           Number(form.querySelector('#editor-f-min-rent')?.value)    || 0,
      maxTotalChf:           Number(form.querySelector('#editor-f-max-rent')?.value)    || 1400,
      minRoomsPreferred:     Number(form.querySelector('#editor-f-min-rooms')?.value)   || 2,
      minSurfaceM2Preferred: Number(form.querySelector('#editor-f-min-surface')?.value) || 0,
      maxPublishedAgeDays:   Number(form.querySelector('#editor-f-max-age')?.value)     || 30,
      allowMissingSurface:   !!(form.querySelector('#editor-f-allow-missing-surface')?.checked)
    },
    preferences: {
      workplaceAddress: form.querySelector('#editor-f-workplace')?.value.trim() || null
    }
  };
}
