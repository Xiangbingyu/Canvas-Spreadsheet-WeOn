function createUserOpStateCache() {
  const cache = new Map();

  return {
    cache,

    get(key) {
      return cache.get(key);
    },

    set(key, value) {
      cache.set(key, value);
    },

    delete(key) {
      cache.delete(key);
    },
  };
}

module.exports = createUserOpStateCache();
