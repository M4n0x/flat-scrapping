export const STATUS_KEYS = ['sorting', 'pursuing', 'archived'];

export const DEFAULT_STATUS = 'sorting';

export const STATUS_LABELS = {
  sorting: 'À trier',
  pursuing: 'À poursuivre',
  archived: 'Archivé'
};

const LEGACY_TO_NEW = new Map([
  ['à contacter', 'sorting'],
  ['visite', 'pursuing'],
  ['dossier', 'pursuing'],
  ['relance', 'pursuing'],
  ['accepté', 'pursuing'],
  ['refusé', 'archived'],
  ['sans réponse', 'archived']
]);

export function isValidStatus(value) {
  return typeof value === 'string' && STATUS_KEYS.includes(value);
}

export function migrateStatus(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (STATUS_KEYS.includes(lower)) return lower;
  return LEGACY_TO_NEW.get(lower) || null;
}
