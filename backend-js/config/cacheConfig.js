function normalizeCacheDriver(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return normalizedValue === 'redis' ? 'redis' : 'memory';
}

function normalizePositiveNumber(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function normalizePrefix(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmedValue = value.trim();
  return trimmedValue || fallback;
}

module.exports = {
  driver: normalizeCacheDriver(process.env.CACHE_DRIVER),
  keyPrefix: normalizePrefix(process.env.CACHE_KEY_PREFIX, 'collab'),
  docSnapshotTtlMs: normalizePositiveNumber(process.env.DOC_SNAPSHOT_CACHE_TTL_MS, 5 * 60 * 1000),
  docMetaTtlMs: normalizePositiveNumber(process.env.DOC_META_CACHE_TTL_MS, 10 * 60 * 1000),
  userDocsListTtlMs: normalizePositiveNumber(process.env.USER_DOCS_LIST_CACHE_TTL_MS, 60 * 1000),
  memoryMaxEntries: normalizePositiveNumber(process.env.CACHE_MEMORY_MAX_ENTRIES, 1000),
};
