const streamConfig = require('../../config/streamConfig');
const { createRealtimeKeys } = require('../../infra/redis/realtimeKeys');
const { createRealtimeClient } = require('../../infra/redis/realtimeClient');
const stream = require('../../infra/redis/stream');

// 已确认操作流的消费侧封装，供 Apply&Store worker 使用（Phase 1+2）。
// Gate 的追加(XADD)在 docRealtimeStore.commit 的 Lua 内完成，与此处消费分离。
// Phase 0 仅提供消费/裁剪封装，不在任何地方启动消费循环。

function createDocOpStreamStore() {
  const connection = createRealtimeClient('apply-store-stream');
  const keys = createRealtimeKeys();
  const consumerId = `${process.env.SERVER_ID || `server-${process.pid}`}`;

  return {
    type: streamConfig.driver,

    async ensureGroup(docId) {
      const client = await connection.ensureReady();
      await stream.ensureGroup(client, {
        streamKey: keys.streamKey(docId),
        group: streamConfig.consumerGroup,
      });
    },

    async readBatch(docId, { count = streamConfig.batchSize, blockMs } = {}) {
      const client = await connection.ensureReady();
      const result = await stream.readGroup(client, {
        streamKey: keys.streamKey(docId),
        group: streamConfig.consumerGroup,
        consumer: consumerId,
        count,
        blockMs,
      });
      if (!result || result.length === 0) {
        return [];
      }
      return (result[0].messages || []).map((message) => ({
        id: message.id,
        event: JSON.parse(message.message.event),
      }));
    },

    async ack(docId, ids) {
      const client = await connection.ensureReady();
      return stream.ack(client, {
        streamKey: keys.streamKey(docId),
        group: streamConfig.consumerGroup,
        ids,
      });
    },

    async trim(docId) {
      const client = await connection.ensureReady();
      return stream.trimToCount(client, {
        streamKey: keys.streamKey(docId),
        retainCount: streamConfig.retainCount,
      });
    },

    async close() {
      await connection.close();
    },
  };
}

module.exports = createDocOpStreamStore();
module.exports.createDocOpStreamStore = createDocOpStreamStore;
