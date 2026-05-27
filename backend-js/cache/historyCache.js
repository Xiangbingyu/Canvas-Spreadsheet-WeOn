const cacheConfig = require('../config/cacheConfig');

function createHistoryCache() {
  const cache = new Map();
  const maxEntries = Number.isInteger(cacheConfig.historyMaxEntries) && cacheConfig.historyMaxEntries > 0
    ? cacheConfig.historyMaxEntries
    : 1000;

  function evictOldestIfNeeded() {
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  }

  return {
    cache,

    get(key) {
      return cache.get(key);
    },

    set(key, value) {
      cache.set(key, value);
      evictOldestIfNeeded();
    },

    delete(key) {
      cache.delete(key);
    },
  };
}

module.exports = createHistoryCache();
