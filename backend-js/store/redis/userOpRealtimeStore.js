const realtimeConfig = require('../../config/realtimeConfig');
const { createRealtimeKeys } = require('../../infra/redis/realtimeKeys');
const { createRealtimeClient } = require('../../infra/redis/realtimeClient');
const { createUserOpState } = require('../../domain/entities/userOpState');
const collabConfig = require('../../config/collabConfig');

function getTtlSeconds() {
  const ms = Number.isInteger(collabConfig.userOpStateTtlMs) && collabConfig.userOpStateTtlMs > 0
    ? collabConfig.userOpStateTtlMs
    : 30 * 60 * 1000;
  return Math.ceil(ms / 1000);
}

function createMemoryUserOpRealtimeStore() {
  const store = new Map();

  function key(docId, clientId) { return `${docId}:${clientId}`; }

  return {
    type: 'memory',
    async getState(docId, clientId) {
      return store.get(key(docId, clientId)) || null;
    },
    async saveState(state) {
      const row = createUserOpState(state);
      store.set(key(row.docId, row.clientId), row);
      return row;
    },
    async clearByDocId(docId) {
      for (const [k, v] of store.entries()) {
        if (v.docId === docId) {
          const cleared = createUserOpState({ ...v, undoStackJson: [], redoStackJson: [] });
          store.set(k, cleared);
        }
      }
    },
    async deleteByDocIdAndClientId(docId, clientId) {
      return store.delete(key(docId, clientId));
    },
  };
}

function createRedisUserOpRealtimeStore() {
  const keys = createRealtimeKeys();
  const client = createRealtimeClient('user-op-realtime');

  async function getRedis() { return client.ensureReady(); }

  return {
    type: 'redis',
    async getState(docId, clientId) {
      const redis = await getRedis();
      const raw = await redis.get(keys.userOpKey(docId, clientId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return createUserOpState({ docId, clientId, ...parsed });
    },
    async saveState(state) {
      const row = createUserOpState(state);
      const redis = await getRedis();
      const payload = JSON.stringify({
        undoStackJson: row.undoStackJson,
        redoStackJson: row.redoStackJson,
        updatedAt: row.updatedAt,
      });
      await redis.set(keys.userOpKey(row.docId, row.clientId), payload, { EX: getTtlSeconds() });
      return row;
    },
    async clearByDocId(docId, clientIds = []) {
      if (!clientIds.length) return;
      const redis = await getRedis();
      const cleared = createUserOpState({ undoStackJson: [], redoStackJson: [] });
      const payload = JSON.stringify({
        undoStackJson: [],
        redoStackJson: [],
        updatedAt: cleared.updatedAt,
      });
      await Promise.all(
        clientIds.map((cid) => redis.set(keys.userOpKey(docId, cid), payload, { EX: getTtlSeconds() }))
      );
    },
    async deleteByDocIdAndClientId(docId, clientId) {
      const redis = await getRedis();
      const deleted = await redis.del(keys.userOpKey(docId, clientId));
      return deleted > 0;
    },
  };
}

function createUserOpRealtimeStore() {
  return realtimeConfig.driver === 'redis'
    ? createRedisUserOpRealtimeStore()
    : createMemoryUserOpRealtimeStore();
}

module.exports = createUserOpRealtimeStore();
module.exports.createUserOpRealtimeStore = createUserOpRealtimeStore;
