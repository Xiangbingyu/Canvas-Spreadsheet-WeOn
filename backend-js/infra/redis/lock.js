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
const RENEW_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
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

  async function renewLock(docId, token) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return 0;
    }

    return client.eval(RENEW_LOCK_SCRIPT, {
      keys: [getLockKey(docId)],
      arguments: [token, String(lockConfig.ttlMs)],
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

      let renewalTimer;
      try {
        let renewalInFlight = false;
        if (lockConfig.ttlMs > 1000) {
          const renewalInterval = Math.floor(lockConfig.ttlMs / 2);
          renewalTimer = setInterval(async () => {
            if (renewalInFlight) {
              return;
            }

            renewalInFlight = true;
            try {
              if (client.isOpen) {
                const renewed = await renewLock(docId, token);
                if (renewed !== 1) {
                  console.error(`lock renewal skipped for ${docId}: token no longer owns the lock`);
                }
              }
            } catch (err) {
              console.error(`lock renewal failed for ${docId}:`, err);
            } finally {
              renewalInFlight = false;
            }
          }, renewalInterval);
        }
        return await handler();
      } finally {
        if (renewalTimer) clearInterval(renewalTimer);
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
