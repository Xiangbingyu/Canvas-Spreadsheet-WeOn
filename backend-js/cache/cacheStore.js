const cacheConfig = require('../config/cacheConfig');
const { createRedisConnection } = require('../infra/redis/client');

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function createMemoryCacheStore() {
  const entries = new Map();
  const maxEntries = Number.isInteger(cacheConfig.memoryMaxEntries) && cacheConfig.memoryMaxEntries > 0
    ? cacheConfig.memoryMaxEntries
    : 1000;

  function deleteExpiredEntryIfNeeded(key, entry) {
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return true;
    }

    return false;
  }

  function evictOldestIfNeeded() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  }

  return {
    async get(key) {
      const entry = entries.get(key);

      if (!entry || deleteExpiredEntryIfNeeded(key, entry)) {
        return null;
      }

      return cloneJsonValue(entry.value);
    },

    async set(key, value, { ttlMs = null } = {}) {
      const expiresAt = Number.isFinite(ttlMs) && ttlMs > 0
        ? Date.now() + ttlMs
        : null;

      entries.set(key, {
        value: cloneJsonValue(value),
        expiresAt,
      });
      evictOldestIfNeeded();
    },

    async delete(key) {
      entries.delete(key);
    },

    async deleteByPrefix(prefix) {
      for (const key of Array.from(entries.keys())) {
        if (key.startsWith(prefix)) {
          entries.delete(key);
        }
      }
    },

    async close() {
      entries.clear();
    },
  };
}

function createRedisCacheStore() {
  const client = createRedisConnection('cache-store');
  let initPromise = null;
  let closePromise = null;
  let isClosing = false;

  async function ensureReady() {
    if (isClosing) {
      return;
    }

    if (!initPromise) {
      initPromise = client.connect().catch((error) => {
        initPromise = null;
        throw error;
      });
    }

    await initPromise;
  }

  function parseJsonValue(rawValue) {
    if (rawValue === null || rawValue === undefined) {
      return null;
    }

    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return null;
    }
  }

  return {
    async get(key) {
      await ensureReady();

      if (isClosing || !client.isOpen) {
        return null;
      }

      return parseJsonValue(await client.get(key));
    },

    async set(key, value, { ttlMs = null } = {}) {
      await ensureReady();

      if (isClosing || !client.isOpen) {
        return;
      }

      const serializedValue = JSON.stringify(value === undefined ? null : value);

      if (Number.isFinite(ttlMs) && ttlMs > 0) {
        await client.set(key, serializedValue, { PX: ttlMs });
        return;
      }

      await client.set(key, serializedValue);
    },

    async delete(key) {
      await ensureReady();

      if (isClosing || !client.isOpen) {
        return;
      }

      await client.del(key);
    },

    async deleteByPrefix(prefix) {
      await ensureReady();

      if (isClosing || !client.isOpen) {
        return;
      }

      const matchedKeys = [];

      for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
        matchedKeys.push(key);
      }

      if (matchedKeys.length > 0) {
        await client.del(matchedKeys);
      }
    },

    async close() {
      if (!closePromise) {
        closePromise = (async () => {
          isClosing = true;

          if (initPromise) {
            await initPromise.catch(() => {});
          }

          if (client.isOpen) {
            await client.quit().catch(() => client.disconnect());
          }

          if (client.isOpen) {
            await client.disconnect().catch(() => {});
          }

          initPromise = null;
        })();
      }

      await closePromise;
    },
  };
}

module.exports = cacheConfig.driver === 'redis'
  ? createRedisCacheStore()
  : createMemoryCacheStore();
