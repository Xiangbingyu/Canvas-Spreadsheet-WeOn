const crypto = require('node:crypto');

const lockConfig = require('../../config/lockConfig');
const { createRedisConnection } = require('./client');

const LOCK_PREFIX = 'collab:lock:doc';
const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

function createNoopLockManager() {
  return {
    async withDocLock(docId, handler) {
      return handler();
    },
    async close() {},
  };
}

function createRedisLockManager() {
  const client = createRedisConnection('doc-lock');
  let initPromise = null;
  let closePromise = null;
  let isClosing = false;

  function getLockKey(docId) {
    return `${LOCK_PREFIX}:${docId}`;
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

  async function releaseLock(docId, token) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return;
    }

    await client.eval(RELEASE_LOCK_SCRIPT, {
      keys: [getLockKey(docId)],
      arguments: [token],
    });
  }

  return {
    async withDocLock(docId, handler) {
      await ensureReady();

      if (isClosing || !client.isOpen) {
        return handler();
      }

      const token = crypto.randomUUID();
      const startedAt = Date.now();

      while (true) {
        const result = await client.set(getLockKey(docId), token, {
          NX: true,
          PX: lockConfig.ttlMs,
        });

        if (result === 'OK') {
          break;
        }

        if (Date.now() - startedAt >= lockConfig.waitTimeoutMs) {
          throw new Error(`failed to acquire doc lock for ${docId}`);
        }

        await new Promise((resolve) => setTimeout(resolve, lockConfig.retryIntervalMs));
      }

      try {
        return await handler();
      } finally {
        await releaseLock(docId, token).catch((error) => {
          console.error(`release doc lock failed for ${docId}:`, error);
        });
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

module.exports = lockConfig.driver === 'redis'
  ? createRedisLockManager()
  : createNoopLockManager();
