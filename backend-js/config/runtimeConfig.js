function normalizeRuntimeDriver(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return normalizedValue === 'redis' ? 'redis' : 'memory';
}

module.exports = {
  driver: normalizeRuntimeDriver(process.env.RUNTIME_STATE_DRIVER),
};
