function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function positiveConfigNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isBudgetEligible(item, config) {
  const maxBudget = positiveConfigNumber(config.filters?.maxTotalChf, 1400);
  return item.totalChf != null && Number(item.totalChf) <= maxBudget;
}

export function derivePriority(item, config) {
  const listingStage = String(item?.listingStage || '').toLowerCase();
  if (listingStage === 'off_market') return 'A';
  if (listingStage === 'early_market') return 'A-';

  const budget = positiveConfigNumber(config.filters?.maxTotalChf, 1400);
  const minRooms = positiveConfigNumber(config.filters?.minRoomsPreferred, 2);
  const rooms = Number(item.rooms ?? 0);
  const total = Number(item.totalChf ?? 999999);

  if (total <= budget && rooms >= minRooms) return 'A';
  return 'B';
}

export function isSizeEligible(item, config) {
  const minRooms = positiveConfigNumber(config.filters?.minRoomsPreferred, 2);
  const minSurface = Number(config.filters?.minSurfaceM2Preferred ?? 0);
  const minSurfaceFallback = Number(config.filters?.minSurfaceM2Fallback ?? 0);
  const allowMissingSurface = config.filters?.allowMissingSurface !== false;

  const rooms = toPositiveNumber(item.rooms);
  if (rooms == null || rooms < minRooms) return false;

  const surface = toPositiveNumber(item.surfaceM2);
  const hasSurface = surface != null;

  if (minSurfaceFallback > 0 && hasSurface && surface >= minSurfaceFallback) return true;
  if (!Number.isFinite(minSurface) || minSurface <= 0) return true;
  if (!hasSurface) return allowMissingSurface;

  return surface >= minSurface;
}
