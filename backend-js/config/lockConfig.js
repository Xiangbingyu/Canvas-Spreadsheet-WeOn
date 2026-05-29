function normalizeDriver(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return normalizedValue === 'redis' ? 'redis' : 'memory';
}

function normalizePositiveNumber(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

module.exports = {
  driver: normalizeDriver(process.env.DOC_LOCK_DRIVER),
  ttlMs: normalizePositiveNumber(process.env.DOC_LOCK_TTL_MS, 8000),
  waitTimeoutMs: normalizePositiveNumber(process.env.DOC_LOCK_WAIT_TIMEOUT_MS, 3000),
  retryIntervalMs: normalizePositiveNumber(process.env.DOC_LOCK_RETRY_INTERVAL_MS, 50),
};
