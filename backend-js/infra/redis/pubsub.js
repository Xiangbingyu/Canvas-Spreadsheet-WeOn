const { createRedisConnection } = require('./client');

const DEFAULT_CHANNEL = 'collab.doc.events';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function getCollabBroadcastChannel() {
  return isNonEmptyString(process.env.COLLAB_BROADCAST_CHANNEL)
    ? process.env.COLLAB_BROADCAST_CHANNEL.trim()
    : DEFAULT_CHANNEL;
}

function createRedisPubSub({ serverId, onMessage }) {
  let publisher = null;
  let subscriber = null;
  let started = false;
  let startPromise = null;
  let isClosing = false;

  async function closeClient(client) {
    if (!client) {
      return;
    }

    try {
      if (client.isOpen) {
        await client.quit().catch(() => {});
      }
    } finally {
      await client.disconnect().catch(() => {});
    }
  }

  async function ensureStarted() {
    if (started) {
      return;
    }

    if (!startPromise) {
      startPromise = (async () => {
        publisher = createRedisConnection('redis-publisher');
        subscriber = createRedisConnection('redis-subscriber');

        await publisher.connect();
        await subscriber.connect();

        await subscriber.subscribe(getCollabBroadcastChannel(), async (rawMessage) => {
          let parsedMessage = null;

          try {
            parsedMessage = JSON.parse(rawMessage);
          } catch (error) {
            console.error('redis pubsub message parse failed:', error);
            return;
          }

          if (!parsedMessage || parsedMessage.serverId === serverId) {
            return;
          }

          try {
            await onMessage(parsedMessage);
          } catch (error) {
            console.error('redis pubsub message handler failed:', error);
          }
        });

        started = true;
      })().catch((error) => {
        // connect/subscribe 过程中任一阶段失败，都要确保已创建连接被回收。
        const failedPublisher = publisher;
        const failedSubscriber = subscriber;
        startPromise = null;
        publisher = null;
        subscriber = null;
        void Promise.all([
          closeClient(failedSubscriber),
          closeClient(failedPublisher),
        ]).catch(() => {});
        throw error;
      });
    }

    await startPromise;
  }

  async function publish(message) {
    if (isClosing) {
      return;
    }

    await ensureStarted();
    if (!publisher || !publisher.isOpen) {
      return;
    }

    await publisher.publish(
      getCollabBroadcastChannel(),
      JSON.stringify({
        ...message,
        serverId,
      })
    );
  }

  async function close() {
    isClosing = true;

    if (startPromise) {
      await startPromise.catch(() => {});
    }

    await Promise.all([
      closeClient(subscriber),
      closeClient(publisher),
    ]);
    started = false;
    startPromise = null;
    publisher = null;
    subscriber = null;
    isClosing = false;
  }

  return {
    ensureStarted,
    publish,
    close,
  };
}

module.exports = {
  createRedisPubSub,
  getCollabBroadcastChannel,
};
