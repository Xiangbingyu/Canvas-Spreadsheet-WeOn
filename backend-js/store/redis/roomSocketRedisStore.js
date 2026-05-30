const { createRoomSocket } = require('../../domain/entities/roomSocket');
const { createId } = require('../../utils/id');
const { createRedisConnection } = require('../../infra/redis/client');

const RUNTIME_PREFIX = 'collab:runtime:room_socket';

function createRoomSocketRedisStore() {
  const client = createRedisConnection('room-socket-runtime');
  const runtimeSocketsByDocId = new Map();
  const runtimeConnectionIdBySocket = new Map();
  const runtimeRowsByConnectionId = new Map();
  const serverId = process.env.SERVER_ID || `server-${process.pid}`;

  let initPromise = null;
  let isClosing = false;
  let closePromise = null;

  function ensureRuntimeRoom(docId) {
    if (!runtimeSocketsByDocId.has(docId)) {
      runtimeSocketsByDocId.set(docId, new Map());
    }

    return runtimeSocketsByDocId.get(docId);
  }

  function getConnectionKey(connectionId) {
    return `${RUNTIME_PREFIX}:conn:${connectionId}`;
  }

  function getDocConnectionsKey(docId) {
    return `${RUNTIME_PREFIX}:doc:${docId}:connections`;
  }

  function getDocClientConnectionsKey(docId, clientId) {
    return `${RUNTIME_PREFIX}:doc:${docId}:client:${clientId}:connections`;
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

  function parseStoredRow(rawValue) {
    if (!rawValue) {
      return null;
    }

    try {
      return createRoomSocket(JSON.parse(rawValue));
    } catch (error) {
      return null;
    }
  }

  async function getStoredRowByConnectionId(connectionId) {
    if (!connectionId) {
      return null;
    }

    const localRow = runtimeRowsByConnectionId.get(connectionId);
    if (localRow && (isClosing || !client.isOpen)) {
      return localRow;
    }

    await ensureReady();
    if (isClosing || !client.isOpen) {
      return runtimeRowsByConnectionId.get(connectionId) || null;
    }
    const rawValue = await client.get(getConnectionKey(connectionId));
    return parseStoredRow(rawValue);
  }

  async function listRowsByConnectionIds(connectionIds = []) {
    if (!connectionIds.length) {
      return [];
    }

    if (isClosing || !client.isOpen) {
      return connectionIds
        .map((connectionId) => runtimeRowsByConnectionId.get(connectionId) || null)
        .filter(Boolean);
    }

    await ensureReady();
    if (isClosing || !client.isOpen) {
      return connectionIds
        .map((connectionId) => runtimeRowsByConnectionId.get(connectionId) || null)
        .filter(Boolean);
    }
    const rawValues = await client.mGet(connectionIds.map((connectionId) => getConnectionKey(connectionId)));

    return rawValues
      .map((rawValue) => parseStoredRow(rawValue))
      .filter(Boolean);
  }

  async function removeIndexesForRow(row) {
    if (!row) {
      return;
    }

    if (isClosing || !client.isOpen) {
      return;
    }

    await client.sRem(getDocConnectionsKey(row.docId), row.connectionId);
    await client.sRem(getDocClientConnectionsKey(row.docId, row.clientId), row.connectionId);
  }

  async function saveRow(rowInput = {}) {
    await ensureReady();

    const connectionId = rowInput.connectionId || createId(`conn_${serverId}`);
    const current = await getStoredRowByConnectionId(connectionId);
    const row = current
      ? createRoomSocket({
        ...current,
        ...rowInput,
        id: current.id,
        connectionId: current.connectionId,
      })
      : createRoomSocket({
        ...rowInput,
        id: rowInput.id || connectionId,
        connectionId,
        serverId: rowInput.serverId || serverId,
      });

    if (current && (current.docId !== row.docId || current.clientId !== row.clientId)) {
      await removeIndexesForRow(current);
    }

    if (isClosing || !client.isOpen) {
      return row;
    }

    const multi = client.multi();
    multi.set(getConnectionKey(row.connectionId), JSON.stringify(row));
    multi.sAdd(getDocConnectionsKey(row.docId), row.connectionId);
    multi.sAdd(getDocClientConnectionsKey(row.docId, row.clientId), row.connectionId);
    await multi.exec();

    return row;
  }

  async function deleteByConnectionId(connectionId) {
    const current = await getStoredRowByConnectionId(connectionId);

    if (!current) {
      return false;
    }

    if (!isClosing && client.isOpen) {
      const multi = client.multi();
      multi.del(getConnectionKey(connectionId));
      multi.sRem(getDocConnectionsKey(current.docId), connectionId);
      multi.sRem(getDocClientConnectionsKey(current.docId, current.clientId), connectionId);
      await multi.exec();
    }

    const runtimeRoom = runtimeSocketsByDocId.get(current.docId);
    if (runtimeRoom) {
      const socket = runtimeRoom.get(connectionId);
      if (socket) {
        runtimeConnectionIdBySocket.delete(socket);
      }
      runtimeRoom.delete(connectionId);
    }

    return true;
  }

  async function purgeRuntimeRowsForServer() {
    if (!client.isOpen || runtimeRowsByConnectionId.size === 0) {
      return;
    }

    const multi = client.multi();

    for (const row of runtimeRowsByConnectionId.values()) {
      multi.del(getConnectionKey(row.connectionId));
      multi.sRem(getDocConnectionsKey(row.docId), row.connectionId);
      multi.sRem(getDocClientConnectionsKey(row.docId, row.clientId), row.connectionId);
    }

    await multi.exec();
  }

  return {
    type: 'redis',
    tableName: 'room_socket_runtime',
    runtimeSocketsByDocId,
    runtimeConnectionIdBySocket,

    async create(rowInput = {}) {
      return saveRow(rowInput);
    },

    async upsert(rowInput = {}) {
      return saveRow(rowInput);
    },

    async findByConnectionId(connectionId) {
      return getStoredRowByConnectionId(connectionId);
    },

    async findBySocket(socket) {
      const connectionId = runtimeConnectionIdBySocket.get(socket);
      return getStoredRowByConnectionId(connectionId);
    },

    async listByDocId(docId) {
      if (isClosing || !client.isOpen) {
        return Array.from(runtimeRowsByConnectionId.values())
          .filter((row) => row.docId === docId)
          .sort((left, right) => left.connectedAt.localeCompare(right.connectedAt));
      }

      await ensureReady();
      const connectionIds = await client.sMembers(getDocConnectionsKey(docId));
      const rows = await listRowsByConnectionIds(connectionIds);
      return rows.sort((left, right) => left.connectedAt.localeCompare(right.connectedAt));
    },

    async listByDocIdAndClientId(docId, clientId) {
      if (isClosing || !client.isOpen) {
        return Array.from(runtimeRowsByConnectionId.values())
          .filter((row) => row.docId === docId && row.clientId === clientId)
          .sort((left, right) => left.connectedAt.localeCompare(right.connectedAt));
      }

      await ensureReady();
      const connectionIds = await client.sMembers(getDocClientConnectionsKey(docId, clientId));
      const rows = await listRowsByConnectionIds(connectionIds);
      return rows.sort((left, right) => left.connectedAt.localeCompare(right.connectedAt));
    },

    async deleteByConnectionId(connectionId) {
      return deleteByConnectionId(connectionId);
    },

    async addSocketToRoom(docId, socket, clientId, metadata = {}) {
      const existingConnId = runtimeConnectionIdBySocket.get(socket);
      let previousEntry = null;

      if (existingConnId) {
        const existingRow = await getStoredRowByConnectionId(existingConnId);
        if (existingRow) {
          if (existingRow.docId !== docId || existingRow.clientId !== clientId) {
            previousEntry = { docId: existingRow.docId, clientId: existingRow.clientId };
          }

          const oldRoom = runtimeSocketsByDocId.get(existingRow.docId);
          if (oldRoom) {
            oldRoom.delete(existingConnId);
          }
        }
      }

      const generatedConnectionId = existingConnId || `${serverId}:${socket._connId || createId('conn')}`;
      const row = await saveRow({
        connectionId: generatedConnectionId,
        docId,
        clientId,
        serverId,
        status: 'connected',
        ...metadata,
      });

      const runtimeRoom = ensureRuntimeRoom(docId);
      runtimeRoom.set(row.connectionId, socket);
      runtimeConnectionIdBySocket.set(socket, row.connectionId);
      runtimeRowsByConnectionId.set(row.connectionId, row);
      return { row, previousEntry };
    },

    async getRoomSockets(docId) {
      return Array.from((runtimeSocketsByDocId.get(docId) || new Map()).values());
    },

    async removeSocket(socket) {
      const connectionId = runtimeConnectionIdBySocket.get(socket);

      if (!connectionId) {
        return null;
      }

      const current = await getStoredRowByConnectionId(connectionId);
      runtimeConnectionIdBySocket.delete(socket);

      if (!current) {
        return null;
      }

      const runtimeRoom = runtimeSocketsByDocId.get(current.docId);
      if (runtimeRoom) {
        runtimeRoom.delete(connectionId);
      }

      await deleteByConnectionId(connectionId);
      runtimeRowsByConnectionId.delete(connectionId);

      return createRoomSocket({
        ...current,
        status: 'closed',
        lastActiveAt: new Date().toISOString(),
      });
    },

    async close() {
      if (!closePromise) {
        closePromise = (async () => {
          isClosing = true;

          if (initPromise) {
            await initPromise.catch(() => {});
          }

          if (client.isOpen) {
            await purgeRuntimeRowsForServer().catch(() => {});
            await client.quit().catch(() => client.disconnect());
          }

          if (client.isOpen) {
            await client.disconnect().catch(() => {});
          }

          initPromise = null;
          runtimeSocketsByDocId.clear();
          runtimeConnectionIdBySocket.clear();
          runtimeRowsByConnectionId.clear();
        })();
      }

      await closePromise;
    },
  };
}

module.exports = createRoomSocketRedisStore;
