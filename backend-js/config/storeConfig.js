const supportedDrivers = new Set(['memory', 'mysql']);

function normalizeDriver(value) {
  if (typeof value !== 'string') {
    return 'memory';
  }

  const normalizedValue = value.trim().toLowerCase();
  return supportedDrivers.has(normalizedValue) ? normalizedValue : 'memory';
}

const storeConfig = {
  driver: normalizeDriver(process.env.STORE_DRIVER || 'memory'),
};

module.exports = storeConfig;
