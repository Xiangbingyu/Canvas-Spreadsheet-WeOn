function normalizeDriver(value) {
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
  // 'memory'(默认) | 'redis'：已确认操作流驱动。
  driver: normalizeDriver(process.env.OP_STREAM_DRIVER),
  consumerGroup: normalizePrefix(process.env.STREAM_CONSUMER_GROUP, 'apply-store'),
  batchSize: normalizePositiveNumber(process.env.STREAM_BATCH_SIZE, 64),
  // 保留窗口：checkpoint 之后 + 至少最近 N 条，兜底极陈旧 client 的 rebase。
  retainCount: normalizePositiveNumber(process.env.STREAM_RETAIN_COUNT, 500),
};
