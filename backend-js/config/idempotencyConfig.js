function normalizeDriver(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return normalizedValue === 'redis' ? 'redis' : 'memory';
}

function normalizePositiveNumber(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

module.exports = {
  driver: normalizeDriver(process.env.IDEMPOTENCY_DRIVER),
  ttlMs: normalizePositiveNumber(process.env.IDEMPOTENCY_TTL_MS, 10 * 60 * 1000),
  processingWaitTimeoutMs: normalizePositiveNumber(process.env.IDEMPOTENCY_PROCESSING_WAIT_TIMEOUT_MS, 2000),
  processingPollIntervalMs: normalizePositiveNumber(process.env.IDEMPOTENCY_PROCESSING_POLL_INTERVAL_MS, 50),
};
