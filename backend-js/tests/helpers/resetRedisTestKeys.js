'use strict';

const { createRedisConnection } = require('../../infra/redis/client');

function usesRedisBackends() {
  return [
    process.env.CACHE_DRIVER,
    process.env.RUNTIME_STATE_DRIVER,
    process.env.COLLAB_BROADCAST_DRIVER,
    process.env.IDEMPOTENCY_DRIVER,
    process.env.DOC_LOCK_DRIVER,
  ].includes('redis');
}

async function resetRedisTestKeys() {
  if (!usesRedisBackends()) {
    return;
  }

  const prefix = typeof process.env.CACHE_KEY_PREFIX === 'string' && process.env.CACHE_KEY_PREFIX.trim()
    ? process.env.CACHE_KEY_PREFIX.trim()
    : 'collab';
  const client = createRedisConnection('test-reset');

  try {
    await client.connect();

    for await (const keys of client.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) {
      if (keys.length > 0) {
        await client.del(keys);
      }
    }
  } finally {
    if (client.isOpen) {
      await client.quit().catch(() => client.disconnect());
    }
  }
}

module.exports = {
  resetRedisTestKeys,
};
