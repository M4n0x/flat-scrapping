const STATUS_LABELS = { sorting: 'À trier', pursuing: 'À poursuivre', archived: 'Archivé' };
const PRIORITY_KEYS = ['A', 'A-', 'B'];

export function renderSidebar({ profiles, sources }, state, onChange) {
  const profilesEl = document.getElementById('filter-profiles');
  const recentEl = document.getElementById('filter-recent');
  const unreadEl = document.getElementById('filter-unread');
  const statusEl = document.getElementById('filter-status');
  const priorityEl = document.getElementById('filter-priority');
  const sourcesEl = document.getElementById('filter-sources');

  const emit = (mutator) => {
    const next = clone(state);
    mutator(next);
    Object.assign(state, next);
    onChange(clone(state));
  };

  // --- Profiles
  profilesEl.replaceChildren();
  for (const profile of profiles) {
    const row = document.createElement('div');
    row.className = 'filter-profile-row';

    const dot = document.createElement('span');
    dot.className = 'profile-dot';
    dot.style.background = profile.color || '#56d4b8';

    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = profile.title || profile.name || profile.slug;

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'profile-eye';
    const visible = !state.hiddenProfiles.has(profile.slug);
    if (!visible) eye.classList.add('off');
    eye.setAttribute('aria-label', visible ? 'Masquer' : 'Afficher');
    eye.textContent = visible ? '👁' : '🚫';
    eye.addEventListener('click', () => {
      emit((next) => {
        const set = new Set(next.hiddenProfiles);
        if (set.has(profile.slug)) set.delete(profile.slug); else set.add(profile.slug);
        next.hiddenProfiles = set;
      });
    });

    row.append(dot, name, eye);
    profilesEl.appendChild(row);
  }

  // --- Recent
  recentEl.value = state.recent;
  recentEl.addEventListener('change', () => {
    emit((next) => { next.recent = recentEl.value; });
  });

  // --- Unread
  unreadEl.checked = state.unreadOnly === true;
  unreadEl.addEventListener('change', () => {
    emit((next) => { next.unreadOnly = unreadEl.checked; });
  });

  // --- Status
  statusEl.replaceChildren();
  for (const key of Object.keys(STATUS_LABELS)) {
    statusEl.appendChild(buildCheckbox({
      label: STATUS_LABELS[key],
      checked: state.statuses.has(key),
      onChange: (checked) => emit((next) => {
        const set = new Set(next.statuses);
        if (checked) set.add(key); else set.delete(key);
        next.statuses = set;
      })
    }));
  }

  // --- Priority
  priorityEl.replaceChildren();
  for (const key of PRIORITY_KEYS) {
    priorityEl.appendChild(buildCheckbox({
      label: key,
      checked: state.priorities.has(key),
      onChange: (checked) => emit((next) => {
        const set = new Set(next.priorities);
        if (checked) set.add(key); else set.delete(key);
        next.priorities = set;
      })
    }));
  }

  // --- Sources
  if (state.sources == null) state.sources = new Set(sources);
  sourcesEl.replaceChildren();
  for (const source of sources) {
    sourcesEl.appendChild(buildCheckbox({
      label: source,
      checked: state.sources.has(source),
      onChange: (checked) => emit((next) => {
        const set = new Set(next.sources || []);
        if (checked) set.add(source); else set.delete(source);
        next.sources = set;
      })
    }));
  }
}

function buildCheckbox({ label, checked, onChange }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'filter-checkbox';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.textContent = ' ' + label;
  wrapper.append(input, text);
  return wrapper;
}

function clone(state) {
  return {
    hiddenProfiles: new Set(state.hiddenProfiles),
    recent: state.recent,
    unreadOnly: state.unreadOnly,
    statuses: new Set(state.statuses),
    priorities: new Set(state.priorities),
    sources: state.sources ? new Set(state.sources) : null
  };
}
