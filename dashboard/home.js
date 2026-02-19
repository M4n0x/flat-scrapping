const gridEl = document.getElementById('profiles-grid');
const createSection = document.getElementById('create-section');
const formEl = document.getElementById('profile-form');
const formTitleEl = document.getElementById('form-title');
const formSubmitEl = document.getElementById('form-submit');
const formCancelEl = document.getElementById('form-cancel');
const editSlugEl = document.getElementById('edit-slug');
const zonesListEl = document.getElementById('zones-list');
const addZoneBtn = document.getElementById('add-zone');

let zones = [];
let allProfiles = [];

// --- Zone management ---

function renderZones() {
  zonesListEl.innerHTML = '';
  if (!zones.length) {
    zonesListEl.innerHTML = '<span style="color:var(--muted);font-size:0.82rem">Aucune zone ajoutée</span>';
    return;
  }
  for (const z of zones) {
    const chip = document.createElement('span');
    chip.className = 'zone-chip';
    chip.innerHTML = `${escapeHtml(z.label)} <small style="opacity:.6">(${escapeHtml(z.slug)})</small>
      <button type="button" class="remove-zone" title="Retirer">&times;</button>`;
    chip.querySelector('.remove-zone').addEventListener('click', () => {
      zones = zones.filter((x) => x.slug !== z.slug);
      renderZones();
    });
    zonesListEl.appendChild(chip);
  }
}

addZoneBtn.addEventListener('click', () => {
  const slugInput = document.getElementById('zone-slug');
  const labelInput = document.getElementById('zone-label');
  const slug = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  const label = labelInput.value.trim();
  if (!slug || !label) return;
  if (zones.some((z) => z.slug === slug)) return;
  zones.push({ slug, label });
  slugInput.value = '';
  labelInput.value = '';
  renderZones();
});

// --- Form logic ---

function showForm(mode = 'create', profile = null) {
  createSection.classList.remove('hidden');

  if (mode === 'edit' && profile) {
    formTitleEl.textContent = `Modifier – ${profile.shortTitle || profile.slug}`;
    formSubmitEl.textContent = 'Enregistrer';
    editSlugEl.value = profile.slug;

    document.getElementById('f-title').value = profile.shortTitle || '';
    zones = [...(profile.areas || [])];
    document.getElementById('f-max-rent').value = profile.filters?.maxTotalChf ?? 1400;
    document.getElementById('f-hard-max').value = profile.filters?.maxTotalHardChf ?? 1550;
    document.getElementById('f-pearl-max').value = profile.filters?.maxPearlTotalChf ?? 1650;
    document.getElementById('f-min-rooms').value = profile.filters?.minRoomsPreferred ?? 2;
    document.getElementById('f-min-surface').value = profile.filters?.minSurfaceM2Preferred ?? 0;
    document.getElementById('f-workplace').value = profile.preferences?.workplaceAddress ?? '';
    document.getElementById('s-immobilier').checked = profile.sources?.immobilier !== false;
    document.getElementById('s-flatfox').checked = profile.sources?.flatfox !== false;
    document.getElementById('s-homegate').checked = !!profile.sources?.homegate;
    document.getElementById('s-anibis').checked = !!profile.sources?.anibis;
    document.getElementById('f-studio').checked = !!profile.filters?.allowStudioTransition;
  } else {
    formTitleEl.textContent = 'Nouveau profil';
    formSubmitEl.textContent = 'Créer le profil';
    editSlugEl.value = '';
    formEl.reset();
    zones = [];
  }

  renderZones();
  createSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideForm() {
  createSection.classList.add('hidden');
  editSlugEl.value = '';
  zones = [];
}

formCancelEl.addEventListener('click', hideForm);

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();

  const isEdit = !!editSlugEl.value;
  const shortTitle = document.getElementById('f-title').value.trim();

  if (!shortTitle) return alert('Titre requis');
  if (!zones.length) return alert('Ajoutez au moins une zone');

  const slug = isEdit
    ? editSlugEl.value
    : shortTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+$/g, '');

  const payload = {
    slug,
    shortTitle,
    areas: zones,
    sources: {
      immobilier: document.getElementById('s-immobilier').checked,
      flatfox: document.getElementById('s-flatfox').checked,
      homegate: document.getElementById('s-homegate').checked,
      anibis: document.getElementById('s-anibis').checked
    },
    filters: {
      maxTotalChf: Number(document.getElementById('f-max-rent').value) || 1400,
      maxTotalHardChf: Number(document.getElementById('f-hard-max').value) || 1550,
      maxPearlTotalChf: Number(document.getElementById('f-pearl-max').value) || 1650,
      minRoomsPreferred: Number(document.getElementById('f-min-rooms').value) || 2,
      minSurfaceM2Preferred: Number(document.getElementById('f-min-surface').value) || 0,
      allowStudioTransition: document.getElementById('f-studio').checked
    },
    preferences: {
      workplaceAddress: document.getElementById('f-workplace').value.trim() || null
    }
  };

  formSubmitEl.disabled = true;
  formSubmitEl.textContent = '…';

  try {
    const endpoint = isEdit ? '/api/profile/update' : '/api/profile/create';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erreur inconnue');
    hideForm();
    await loadProfiles();
  } catch (err) {
    alert(`Erreur: ${err.message}`);
  } finally {
    formSubmitEl.disabled = false;
    formSubmitEl.textContent = isEdit ? 'Enregistrer' : 'Créer le profil';
  }
});

// --- Profile cards ---

function escapeHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderProfiles(profiles) {
  gridEl.innerHTML = '';
  allProfiles = profiles;

  for (const p of profiles) {
    const card = document.createElement('article');
    card.className = 'profile-card';

    card.innerHTML = `
      <h3>${escapeHtml(p.label || p.name)}</h3>
      <div class="card-zones">${escapeHtml(p.areas || 'Aucune zone')}</div>
      <div class="card-stats">
        <span>📊 ${p.listingsCount ?? '–'} annonces</span>
        <span>💰 max ${p.maxRent ? `CHF ${p.maxRent}` : '–'}</span>
      </div>
      <div class="card-actions">
        <a href="/${encodeURIComponent(p.slug)}/dashboard" class="btn primary">Ouvrir</a>
        <button type="button" class="btn ghost edit-btn" data-slug="${escapeHtml(p.slug)}">Modifier</button>
        <button type="button" class="btn ghost delete-btn" data-slug="${escapeHtml(p.slug)}" data-name="${escapeHtml(p.label || p.slug)}">Supprimer</button>
      </div>
    `;

    card.querySelector('.edit-btn').addEventListener('click', () => editProfile(p.slug));
    card.querySelector('.delete-btn').addEventListener('click', (e) => confirmDelete(e.currentTarget));

    gridEl.appendChild(card);
  }

  // Add card
  const addCard = document.createElement('article');
  addCard.className = 'profile-card add-card';
  addCard.innerHTML = `<div class="add-icon">+</div><div class="add-label">Créer un profil</div>`;
  addCard.addEventListener('click', () => showForm('create'));
  gridEl.appendChild(addCard);
}

async function editProfile(slug) {
  try {
    const res = await fetch(`/api/profile/detail?profile=${encodeURIComponent(slug)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    showForm('edit', data.profile);
  } catch (err) {
    alert(`Erreur: ${err.message}`);
  }
}

async function confirmDelete(btn) {
  const slug = btn.dataset.slug;
  const name = btn.dataset.name;
  if (!confirm(`Supprimer le profil « ${name} » et toutes ses données ?\n\nCette action est irréversible.`)) return;

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch('/api/profile/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await loadProfiles();
  } catch (err) {
    alert(`Erreur: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Supprimer';
  }
}

// --- Load ---

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    const { profiles } = await res.json();
    renderProfiles(profiles || []);
  } catch {
    gridEl.innerHTML = '<p style="color:var(--danger)">Impossible de charger les profils.</p>';
  }
}

loadProfiles();
