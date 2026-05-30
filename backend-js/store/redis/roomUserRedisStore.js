const { createRoomUser } = require('../../domain/entities/roomUser');
const { createRedisConnection } = require('../../infra/redis/client');

const RUNTIME_PREFIX = 'collab:runtime:room_user';

function createRoomUserRedisStore() {
  const client = createRedisConnection('room-user-runtime');
  let initPromise = null;
  let closePromise = null;
  let isClosing = false;

  function getDocClientKey(docId, clientId) {
    return `${RUNTIME_PREFIX}:doc:${docId}:client:${clientId}`;
  }

  function getDocClientsKey(docId) {
    return `${RUNTIME_PREFIX}:doc:${docId}:clients`;
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

  function parseRow(rawValue) {
    if (!rawValue) {
      return null;
    }

    try {
      return createRoomUser(JSON.parse(rawValue));
    } catch (error) {
      return null;
    }
  }

  async function getStoredRow(docId, clientId) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return null;
    }

    return parseRow(await client.get(getDocClientKey(docId, clientId)));
  }

  async function listStoredRowsByDocId(docId) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return [];
    }

    const clientIds = await client.sMembers(getDocClientsKey(docId));
    if (clientIds.length === 0) {
      return [];
    }

    const rawValues = await client.mGet(clientIds.map((clientId) => getDocClientKey(docId, clientId)));
    return rawValues
      .map((rawValue) => parseRow(rawValue))
      .filter(Boolean)
      .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
  }

  async function saveRow(rowInput = {}) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return createRoomUser(rowInput);
    }

    const current = await getStoredRow(rowInput.docId, rowInput.clientId);
    const row = current
      ? createRoomUser({
        ...current,
        ...rowInput,
        id: rowInput.id || current.id,
        docId: current.docId,
        clientId: current.clientId,
        joinedAt: current.joinedAt,
      })
      : createRoomUser(rowInput);

    const multi = client.multi();
    multi.set(getDocClientKey(row.docId, row.clientId), JSON.stringify(row));
    multi.sAdd(getDocClientsKey(row.docId), row.clientId);
    await multi.exec();

    return row;
  }

  async function deleteRow(docId, clientId) {
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return false;
    }

    const current = await getStoredRow(docId, clientId);
    if (!current) {
      return false;
    }

    const multi = client.multi();
    multi.del(getDocClientKey(docId, clientId));
    multi.sRem(getDocClientsKey(docId), clientId);
    await multi.exec();
    return true;
  }

  return {
    type: 'redis',
    tableName: 'room_user_runtime',

    async upsert(rowInput = {}) {
      return saveRow(rowInput);
    },

    async findByDocIdAndClientId(docId, clientId) {
      return getStoredRow(docId, clientId);
    },

    async listByDocId(docId) {
      return listStoredRowsByDocId(docId);
    },

    async getRoomUsers(docId) {
      return listStoredRowsByDocId(docId);
    },

    async deleteByDocIdAndClientId(docId, clientId) {
      return deleteRow(docId, clientId);
    },

    async removeRoomUser(docId, clientId) {
      return deleteRow(docId, clientId);
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

module.exports = createRoomUserRedisStore;
