const realtimeConfig = require('../../config/realtimeConfig');
const { createRealtimeKeys } = require('../../infra/redis/realtimeKeys');
const { createRealtimeClient } = require('../../infra/redis/realtimeClient');

function createMemoryDocFlushProgressStore() {
  const flushedSeqByDocId = new Map();

  return {
    type: 'memory',
    async getFlushedSeq(docId) {
      return flushedSeqByDocId.has(docId) ? flushedSeqByDocId.get(docId) : null;
    },
    async setFlushedSeq(docId, seq) {
      if (Number.isInteger(seq) && seq >= 0) {
        flushedSeqByDocId.set(docId, seq);
      }
      return seq;
    },
    async close() {
      flushedSeqByDocId.clear();
    },
  };
}

function createRedisDocFlushProgressStore() {
  const keys = createRealtimeKeys();
  const connection = createRealtimeClient('doc-flush-progress');

  return {
    type: 'redis',
    async getFlushedSeq(docId) {
      const client = await connection.ensureReady();
      if (!client) {
        return null;
      }
      const raw = await client.get(keys.flushedSeqKey(docId));
      return raw === null ? null : Number.parseInt(raw, 10);
    },
    async setFlushedSeq(docId, seq) {
      const client = await connection.ensureReady();
      if (client && Number.isInteger(seq) && seq >= 0) {
        await client.set(keys.flushedSeqKey(docId), String(seq));
      }
      return seq;
    },
    async close() {
      await connection.close();
    },
  };
}

function createDocFlushProgressStore() {
  return realtimeConfig.driver === 'redis'
    ? createRedisDocFlushProgressStore()
    : createMemoryDocFlushProgressStore();
}

module.exports = createDocFlushProgressStore();
module.exports.createDocFlushProgressStore = createDocFlushProgressStore;
