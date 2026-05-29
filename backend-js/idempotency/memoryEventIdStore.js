const idempotencyConfig = require('../config/idempotencyConfig');

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function createMemoryEventIdStore() {
  const entries = new Map();

  function deleteExpiredIfNeeded(key, entry) {
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return true;
    }

    return false;
  }

  function normalizeEntry(entry) {
    if (!entry) {
      return null;
    }

    return {
      ...entry,
      response: cloneJsonValue(entry.response),
    };
  }

  return {
    async get(key) {
      const entry = entries.get(key);

      if (!entry || deleteExpiredIfNeeded(key, entry)) {
        return null;
      }

      return normalizeEntry(entry);
    },

    async begin(key, { ttlMs = idempotencyConfig.ttlMs } = {}) {
      const existing = await this.get(key);

      if (existing) {
        return false;
      }

      const expiresAt = Number.isFinite(ttlMs) && ttlMs > 0
        ? Date.now() + ttlMs
        : null;

      entries.set(key, {
        status: 'processing',
        response: null,
        createdAt: new Date().toISOString(),
        expiresAt,
      });

      return true;
    },

    async complete(key, response, { ttlMs = idempotencyConfig.ttlMs } = {}) {
      const current = await this.get(key);
      const expiresAt = Number.isFinite(ttlMs) && ttlMs > 0
        ? Date.now() + ttlMs
        : null;

      entries.set(key, {
        status: 'completed',
        response: cloneJsonValue(response),
        createdAt: current ? current.createdAt : new Date().toISOString(),
        expiresAt,
      });
    },

    async delete(key) {
      entries.delete(key);
    },

    async close() {
      entries.clear();
    },
  };
}

module.exports = createMemoryEventIdStore;
