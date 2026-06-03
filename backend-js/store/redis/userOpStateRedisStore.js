const { createUserOpState } = require('../../domain/entities/userOpState');
const collabConfig = require('../../config/collabConfig');
const cacheConfig = require('../../config/cacheConfig');
const { createRedisConnection } = require('../../infra/redis/client');

const RUNTIME_PREFIX = `${cacheConfig.keyPrefix}:runtime:user_op_state`;

function getRetentionTtlMs() {
  return Number.isInteger(collabConfig.userOpStateTtlMs) && collabConfig.userOpStateTtlMs > 0
    ? collabConfig.userOpStateTtlMs
    : 30 * 60 * 1000;
}

function parseStoredRow(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    return createUserOpState(JSON.parse(rawValue));
  } catch (error) {
    return null;
  }
}

function getDocClientKey(docId, clientId) {
  return `${RUNTIME_PREFIX}:doc:${docId}:client:${clientId}`;
}

function getDocClientsKey(docId) {
  return `${RUNTIME_PREFIX}:doc:${docId}:clients`;
}

function getGlobalDocClientsKey() {
  return `${RUNTIME_PREFIX}:keys`;
}

function createUserOpStateRedisStore() {
  const client = createRedisConnection('user-op-state-runtime');
  let initPromise = null;
  let closePromise = null;
  let isClosing = false;

  function parseDocClientKey(key) {
    const parts = String(key || '').split(':');
    if (parts.length < 4) {
      return null;
    }

    const clientIndex = parts.lastIndexOf('client');
    const docIndex = parts.lastIndexOf('doc');
    if (docIndex === -1 || clientIndex === -1 || clientIndex <= docIndex) {
      return null;
    }

    return {
      docId: parts.slice(docIndex + 1, clientIndex).join(':'),
      clientId: parts.slice(clientIndex + 1).join(':'),
    };
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

  async function removeIndexEntries(docId, clientId, rowKey = null) {
    if (isClosing || !client.isOpen) {
      return;
    }

    const multi = client.multi();
    multi.sRem(getDocClientsKey(docId), clientId);
    multi.sRem(getGlobalDocClientsKey(), rowKey || getDocClientKey(docId, clientId));
    await multi.exec();
  }

  async function getStoredRow(docId, clientId) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return null;
    }

    const rowKey = getDocClientKey(docId, clientId);
    const row = parseStoredRow(await client.get(rowKey));
    if (!row) {
      await removeIndexEntries(docId, clientId, rowKey);
      return null;
    }

    return row;
  }

  async function saveState(state = {}) {
    await ensureReady();

    const row = createUserOpState(state);
    if (isClosing || !client.isOpen) {
      return row;
    }

    const ttlMs = getRetentionTtlMs();
    const rowKey = getDocClientKey(row.docId, row.clientId);
    const multi = client.multi();
    multi.set(rowKey, JSON.stringify(row), { PX: ttlMs });
    multi.sAdd(getDocClientsKey(row.docId), row.clientId);
    multi.sAdd(getGlobalDocClientsKey(), rowKey);
    await multi.exec();

    return row;
  }

  async function loadStatesByDocId(docId) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return [];
    }

    const clientIds = await client.sMembers(getDocClientsKey(docId));
    if (clientIds.length === 0) {
      return [];
    }

    const rowKeys = clientIds.map((clientId) => getDocClientKey(docId, clientId));
    const rawValues = await client.mGet(rowKeys);
    const rows = [];
    const staleClientIds = [];

    for (let index = 0; index < rawValues.length; index += 1) {
      const row = parseStoredRow(rawValues[index]);
      if (row) {
        rows.push(row);
      } else {
        staleClientIds.push(clientIds[index]);
      }
    }

    if (staleClientIds.length > 0) {
      const multi = client.multi();
      for (const clientId of staleClientIds) {
        multi.sRem(getDocClientsKey(docId), clientId);
        multi.sRem(getGlobalDocClientsKey(), getDocClientKey(docId, clientId));
      }
      await multi.exec();
    }

    return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function listStates() {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return [];
    }

    const rowKeys = await client.sMembers(getGlobalDocClientsKey());
    if (rowKeys.length === 0) {
      return [];
    }

    const rawValues = await client.mGet(rowKeys);
    const rows = [];
    const staleRows = [];

    for (let index = 0; index < rawValues.length; index += 1) {
      const row = parseStoredRow(rawValues[index]);
      if (row) {
        rows.push(row);
      } else {
        staleRows.push(rowKeys[index]);
      }
    }

    if (staleRows.length > 0) {
      const multi = client.multi();
      for (const rowKey of staleRows) {
        multi.sRem(getGlobalDocClientsKey(), rowKey);
        const parsedKey = parseDocClientKey(rowKey);
        if (parsedKey) {
          multi.sRem(getDocClientsKey(parsedKey.docId), parsedKey.clientId);
        }
      }
      await multi.exec();
    }

    return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function deleteState(docId, clientId) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return false;
    }

    const rowKey = getDocClientKey(docId, clientId);
    const deletedCount = await client.del(rowKey);
    await removeIndexEntries(docId, clientId, rowKey);
    return deletedCount > 0;
  }

  return {
    type: 'redis',
    tableName: 'user_op_state_runtime',

    async create(rowInput = {}) {
      return saveState(rowInput);
    },

    async upsert(rowInput = {}) {
      return saveState(rowInput);
    },

    async findByDocIdAndClientId(docId, clientId) {
      return getStoredRow(docId, clientId);
    },

    async list() {
      return listStates();
    },

    async getState(docId, clientId) {
      return getStoredRow(docId, clientId);
    },

    async saveState(state) {
      return saveState(state);
    },

    async deleteByDocIdAndClientId(docId, clientId) {
      return deleteState(docId, clientId);
    },

    async clearByDocId(docId) {
      const rows = await loadStatesByDocId(docId);
      const clearedRows = [];

      for (const row of rows) {
        clearedRows.push(await saveState({
          ...row,
          undoStackJson: [],
          redoStackJson: [],
        }));
      }

      return clearedRows;
    },

    async purgeExpired() {
      return listStates();
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

createUserOpStateRedisStore.getRetentionTtlMs = getRetentionTtlMs;
createUserOpStateRedisStore.getDocClientKey = getDocClientKey;
createUserOpStateRedisStore.getDocClientsKey = getDocClientsKey;
createUserOpStateRedisStore.getGlobalDocClientsKey = getGlobalDocClientsKey;

module.exports = createUserOpStateRedisStore;
