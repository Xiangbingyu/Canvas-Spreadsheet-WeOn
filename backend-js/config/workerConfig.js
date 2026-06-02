function normalizeBoolean(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function normalizePositiveNumber(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

module.exports = {
  // 默认 false：Phase 0 不启动 worker，保证 server 启动行为不变。
  enabled: normalizeBoolean(process.env.PERSIST_WORKER_ENABLED),
  // checkpoint 物化触发：累计 op 条数 / 时间窗口，任一满足即物化。
  snapshotOpInterval: normalizePositiveNumber(process.env.SNAPSHOT_CHECKPOINT_OP_INTERVAL, 200),
  snapshotTimeWindowMs: normalizePositiveNumber(process.env.SNAPSHOT_CHECKPOINT_TIME_WINDOW_MS, 30000),
};
