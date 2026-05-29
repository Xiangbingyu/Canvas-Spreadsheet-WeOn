const storeConfig = require('../config/storeConfig');
const runtimeConfig = require('../config/runtimeConfig');
const createMemoryRoomUserStore = require('./memory/roomUserMemoryStore');
const createRoomUserMysqlStore = require('./mysql/roomUserMysqlStore');
const createRoomUserRedisStore = require('./redis/roomUserRedisStore');

function createCombinedRoomUserStore() {
  const persistentStore = createRoomUserMysqlStore();
  const runtimeStore = createRoomUserRedisStore();

  async function mirrorToRuntime(row) {
    if (!row) {
      return null;
    }

    if (row.status === 'online') {
      return runtimeStore.upsert(row);
    }

    await runtimeStore.removeRoomUser(row.docId, row.clientId);
    return row;
  }

  return {
    type: 'mysql+redis',
    tableName: 'room_user',

    async create(rowInput = {}) {
      const row = await persistentStore.create(rowInput);
      await mirrorToRuntime(row);
      return row;
    },

    async upsert(rowInput = {}) {
      const row = await persistentStore.upsert(rowInput);
      await mirrorToRuntime(row);
      return row;
    },

    async findByDocIdAndClientId(docId, clientId) {
      const runtimeRow = await runtimeStore.findByDocIdAndClientId(docId, clientId);
      if (runtimeRow) {
        return runtimeRow;
      }

      return persistentStore.findByDocIdAndClientId(docId, clientId);
    },

    async listByDocId(docId) {
      return persistentStore.listByDocId(docId);
    },

    async listByClientId(clientId) {
      return persistentStore.listByClientId(clientId);
    },

    async deleteByDocIdAndClientId(docId, clientId) {
      const removed = await persistentStore.deleteByDocIdAndClientId(docId, clientId);
      await runtimeStore.deleteByDocIdAndClientId(docId, clientId);
      return removed;
    },

    async upsertRoomUser(docId, user) {
      const row = await persistentStore.upsertRoomUser(docId, user);
      await mirrorToRuntime(row);
      return row;
    },

    async getRoomUsers(docId) {
      const runtimeUsers = await runtimeStore.getRoomUsers(docId);
      if (runtimeUsers.length > 0) {
        return runtimeUsers;
      }

      return persistentStore.getRoomUsers(docId);
    },

    async removeRoomUser(docId, clientId) {
      const removed = await persistentStore.removeRoomUser(docId, clientId);
      await runtimeStore.removeRoomUser(docId, clientId);
      return removed;
    },

    async close() {
      if (typeof runtimeStore.close === 'function') {
        await runtimeStore.close();
      }
    },
  };
}

function createRoomUserStore() {
  if (storeConfig.driver === 'mysql' && runtimeConfig.driver === 'redis') {
    return createCombinedRoomUserStore();
  }

  return storeConfig.driver === 'mysql'
    ? createRoomUserMysqlStore()
    : createMemoryRoomUserStore();
}

module.exports = createRoomUserStore();
