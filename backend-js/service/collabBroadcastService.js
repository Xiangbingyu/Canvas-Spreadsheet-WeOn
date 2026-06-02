const storeConfig = require('../config/storeConfig');
const realtimeConfig = require('../config/realtimeConfig');
const { createRedisPubSub } = require('../infra/redis/pubsub');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function createDefaultServerId() {
  return `server-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

function getBroadcastDriver() {
  return isNonEmptyString(process.env.COLLAB_BROADCAST_DRIVER)
    ? process.env.COLLAB_BROADCAST_DRIVER.trim().toLowerCase()
    : 'memory';
}

function shouldEnableRedisBroadcast() {
  return getBroadcastDriver() === 'redis'
    && (storeConfig.driver === 'mysql' || realtimeConfig.driver === 'redis');
}

function createCollabBroadcastService({ broadcastLocallyToRoom }) {
  const serverId = isNonEmptyString(process.env.SERVER_ID)
    ? process.env.SERVER_ID.trim()
    : createDefaultServerId();

  const redisEnabled = shouldEnableRedisBroadcast();
  const redisPubSub = redisEnabled
    ? createRedisPubSub({
      serverId,
      onMessage: async (message) => {
        if (!message || !isNonEmptyString(message.docId) || !message.payload) {
          return;
        }

        await broadcastLocallyToRoom(message.docId, message.payload);
      },
    })
    : null;

  let startPromise = null;
  let isClosed = false;

  async function ensureStarted() {
    if (!redisPubSub || isClosed) {
      return;
    }

    if (!startPromise) {
      startPromise = redisPubSub.ensureStarted().catch((error) => {
        startPromise = null;
        console.error('collab redis pubsub init failed:', error);
      });
    }

    await startPromise;
  }

  async function broadcastToRoom(docId, payload) {
    if (isClosed) {
      return;
    }

    await broadcastLocallyToRoom(docId, payload);

    if (!redisPubSub || !isNonEmptyString(docId) || !payload) {
      return;
    }

    try {
      await ensureStarted();
      await redisPubSub.publish({
        eventType: payload.type || 'broadcast',
        docId,
        payload,
        publishedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`collab redis publish failed for ${docId}:`, error);
    }
  }

  async function start() {
    if (isClosed) {
      return;
    }

    await ensureStarted();
  }

  async function close() {
    isClosed = true;

    if (redisPubSub) {
      await redisPubSub.close();
    }
  }

  return {
    start,
    close,
    broadcastToRoom,
    isRedisEnabled: redisEnabled,
    serverId,
  };
}

module.exports = {
  createCollabBroadcastService,
};
