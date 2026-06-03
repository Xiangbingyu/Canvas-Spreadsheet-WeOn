const storeConfig = require('../config/storeConfig');
const runtimeConfig = require('../config/runtimeConfig');
const asyncWriteQueue = require('../infra/asyncWriteQueue');
const createMemoryUserOpStateStore = require('./memory/userOpStateMemoryStore');
const createUserOpStateMysqlStore = require('./mysql/userOpStateMysqlStore');
const createUserOpStateRedisStore = require('./redis/userOpStateRedisStore');

function createCombinedUserOpStateStore() {
  const persistentStore = createUserOpStateMysqlStore();
  const runtimeStore = createUserOpStateRedisStore();

  return {
    type: 'mysql+redis',
    tableName: 'user_op_state',

    async create(rowInput = {}, options = {}) {
      return this.saveState(rowInput, options);
    },

    async upsert(rowInput = {}, options = {}) {
      return this.saveState(rowInput, options);
    },

    async findByDocIdAndClientId(docId, clientId, { connection = null } = {}) {
      const runtimeState = await runtimeStore.findByDocIdAndClientId(docId, clientId);
      if (runtimeState) {
        return runtimeState;
      }

      if (connection) {
        return persistentStore.findByDocIdAndClientId(docId, clientId, { connection });
      }

      const persistedState = await persistentStore.findByDocIdAndClientId(docId, clientId);
      if (persistedState) {
        await runtimeStore.saveState(persistedState);
      }

      return persistedState;
    },

    async list() {
      const runtimeStates = await runtimeStore.list();
      if (runtimeStates.length > 0) {
        return runtimeStates;
      }

      return persistentStore.list();
    },

    async getState(docId, clientId, options = {}) {
      return this.findByDocIdAndClientId(docId, clientId, options);
    },

    async saveState(state = {}, { connection = null, runtimeOnly = false } = {}) {
      if (connection) {
        return persistentStore.saveState(state, { connection });
      }

      const runtimeState = await runtimeStore.saveState(state);
      if (runtimeOnly) {
        return runtimeState;
      }

      await asyncWriteQueue.enqueue({
        type: 'upsertUserOpState',
        data: runtimeState,
      });
      return runtimeState;
    },

    async deleteByDocIdAndClientId(docId, clientId, { connection = null, runtimeOnly = false } = {}) {
      if (connection) {
        return persistentStore.deleteByDocIdAndClientId(docId, clientId, { connection });
      }

      const removed = await runtimeStore.deleteByDocIdAndClientId(docId, clientId);
      if (runtimeOnly) {
        return removed;
      }

      await asyncWriteQueue.enqueue({
        type: 'deleteUserOpState',
        data: { docId, clientId },
      });
      return removed;
    },

    async clearByDocId(docId, { connection = null, runtimeOnly = false } = {}) {
      if (connection) {
        return persistentStore.clearByDocId(docId, { connection });
      }

      const clearedRows = await runtimeStore.clearByDocId(docId);
      if (runtimeOnly) {
        return clearedRows;
      }

      await asyncWriteQueue.enqueue({
        type: 'clearUserOpState',
        data: { docId },
      });
      return clearedRows;
    },

    async purgeExpired() {
      return runtimeStore.purgeExpired();
    },

    async syncRuntimeState(state = {}) {
      return runtimeStore.saveState(state);
    },

    async syncRuntimeDelete(docId, clientId) {
      return runtimeStore.deleteByDocIdAndClientId(docId, clientId);
    },

    async syncRuntimeClearByDocId(docId) {
      return runtimeStore.clearByDocId(docId);
    },

    async close() {
      if (typeof runtimeStore.close === 'function') {
        await runtimeStore.close();
      }
    },
  };
}

function createUserOpStateStore() {
  if (storeConfig.driver === 'mysql' && runtimeConfig.driver === 'redis') {
    return createCombinedUserOpStateStore();
  }

  return storeConfig.driver === 'mysql'
    ? createUserOpStateMysqlStore()
    : createMemoryUserOpStateStore();
}

module.exports = createUserOpStateStore();
