function normalizeDriver(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return normalizedValue === 'redis' ? 'redis' : 'memory';
}

function normalizePositiveNumber(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function normalizeNonNegativeNumber(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : fallback;
}

function normalizePrefix(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmedValue = value.trim();
  return trimmedValue || fallback;
}

module.exports = {
  // 'memory'(默认) | 'redis'：Redis 实时态总开关。默认 memory 保证零行为差异。
  driver: normalizeDriver(process.env.REALTIME_STATE_DRIVER),
  keyPrefix: normalizePrefix(process.env.REALTIME_KEY_PREFIX, 'collab:rt'),
  // 0 表示不过期。
  stateTtlMs: normalizeNonNegativeNumber(process.env.REALTIME_STATE_TTL_MS, 0),
};
