const idempotencyConfig = require('../config/idempotencyConfig');
const { createRedisConnection } = require('../infra/redis/client');

const IDEMPOTENCY_PREFIX = 'collab:idempotency';

function createRedisEventIdStore() {
  const client = createRedisConnection('idempotency-store');
  let initPromise = null;
  let closePromise = null;
  let isClosing = false;

  function getKey(key) {
    return `${IDEMPOTENCY_PREFIX}:${key}`;
  }

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

  function parseEntry(rawValue) {
    if (!rawValue) {
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

      return parseEntry(await client.get(getKey(key)));
    },

    async begin(key, { ttlMs = idempotencyConfig.ttlMs } = {}) {
      await ensureReady();

      if (isClosing || !client.isOpen) {
        return false;
      }

      const serializedValue = JSON.stringify({
        status: 'processing',
        response: null,
        createdAt: new Date().toISOString(),
      });

      const response = await client.set(getKey(key), serializedValue, {
        NX: true,
        PX: ttlMs,
      });

      return response === 'OK';
    },

    async complete(key, response, { ttlMs = idempotencyConfig.ttlMs } = {}) {
      await ensureReady();

      if (isClosing || !client.isOpen) {
        return;
      }

      const current = await this.get(key);
      const serializedValue = JSON.stringify({
        status: 'completed',
        response,
        createdAt: current ? current.createdAt : new Date().toISOString(),
      });

      await client.set(getKey(key), serializedValue, {
        PX: ttlMs,
      });
    },

    async delete(key) {
      await ensureReady();

      if (isClosing || !client.isOpen) {
        return;
      }

      await client.del(getKey(key));
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

module.exports = createRedisEventIdStore;
