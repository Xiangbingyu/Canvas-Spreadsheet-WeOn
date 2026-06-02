const { createRedisConnection } = require('./client');

// 实时态共享连接。复用 lock.js / roomSocketRedisStore.js 的懒连接 + 优雅关闭模式。
// Phase 0 仅提供连接生命周期；具体读写在 store/redis/* 中实现。
function createRealtimeClient(name = 'realtime-state') {
  const client = createRedisConnection(name);
  let initPromise = null;
  let closePromise = null;
  let isClosing = false;

  async function ensureReady() {
    if (isClosing) {
      return null;
    }

    if (!initPromise) {
      initPromise = client.connect().catch((error) => {
        initPromise = null;
        throw error;
      });
    }

    await initPromise;
    return client;
  }

  async function close() {
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
  }

  return {
    get raw() {
      return client;
    },
    isClosing() {
      return isClosing;
    },
    ensureReady,
    close,
  };
}

module.exports = {
  createRealtimeClient,
};
