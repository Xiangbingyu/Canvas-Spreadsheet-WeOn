const { createRoomSocket } = require('../../domain/entities/roomSocket');
const { createId } = require('../../utils/id');
const { deepClone } = require('../../utils/clone');

function createAutoIncrement(start = 0) {
  let current = start;

  return function nextId() {
    current += 1;
    return current;
  };
}

function cloneRecord(record) {
  if (!record) {
    return null;
  }

  return deepClone(record);
}

function cloneRecords(records) {
  return records.map((record) => cloneRecord(record));
}

function createRoomSocketMemoryStore() {
  const rowsById = new Map();
  const rowIdByConnectionId = new Map();
  const rowIdsByDocId = new Map();
  const runtimeSocketsByDocId = new Map();
  const runtimeConnectionIdBySocket = new Map();
  const nextPrimaryId = createAutoIncrement();

  function ensureDocRows(docId) {
    if (!rowIdsByDocId.has(docId)) {
      rowIdsByDocId.set(docId, []);
    }

    return rowIdsByDocId.get(docId);
  }

  function ensureRuntimeRoom(docId) {
    if (!runtimeSocketsByDocId.has(docId)) {
      runtimeSocketsByDocId.set(docId, new Map());
    }

    return runtimeSocketsByDocId.get(docId);
  }

  function getStoredRowByConnectionId(connectionId) {
    const rowId = rowIdByConnectionId.get(connectionId);
    return rowId ? rowsById.get(rowId) || null : null;
  }

  function upsert(rowInput = {}) {
    const connectionId = rowInput.connectionId || createId('conn');
    const current = getStoredRowByConnectionId(connectionId);

    if (!current) {
      const row = createRoomSocket({
        ...rowInput,
        id: rowInput.id || nextPrimaryId(),
        connectionId,
      });

      rowsById.set(row.id, row);
      rowIdByConnectionId.set(row.connectionId, row.id);
      ensureDocRows(row.docId).push(row.id);
      return cloneRecord(row);
    }

    const nextRow = createRoomSocket({
      ...current,
      ...rowInput,
      id: current.id,
      connectionId: current.connectionId,
    });

    if (current.docId !== nextRow.docId) {
      rowIdsByDocId.set(
        current.docId,
        (rowIdsByDocId.get(current.docId) || []).filter((rowId) => rowId !== current.id)
      );
      ensureDocRows(nextRow.docId).push(nextRow.id);
    }

    rowsById.set(current.id, nextRow);
    return cloneRecord(nextRow);
  }

  function listRowsByDocId(docId) {
    return (rowIdsByDocId.get(docId) || [])
      .map((rowId) => rowsById.get(rowId))
      .filter(Boolean)
      .sort((left, right) => left.connectedAt.localeCompare(right.connectedAt));
  }

  return {
    type: 'memory',
    tableName: 'room_socket',
    rowsById,
    rowIdByConnectionId,
    rowIdsByDocId,
    runtimeSocketsByDocId,
    runtimeConnectionIdBySocket,

    async create(rowInput = {}) {
      return upsert(rowInput);
    },

    async upsert(rowInput = {}) {
      return upsert(rowInput);
    },

    async findByConnectionId(connectionId) {
      return cloneRecord(getStoredRowByConnectionId(connectionId));
    },

    async findBySocket(socket) {
      const connectionId = runtimeConnectionIdBySocket.get(socket);
      if (!connectionId) {
        return null;
      }
      return cloneRecord(getStoredRowByConnectionId(connectionId));
    },

    async listByDocId(docId) {
      return cloneRecords(listRowsByDocId(docId));
    },

    async listByDocIdAndClientId(docId, clientId) {
      return cloneRecords(listRowsByDocId(docId).filter((row) => row.clientId === clientId));
    },

    async deleteByConnectionId(connectionId) {
      const current = getStoredRowByConnectionId(connectionId);

      if (!current) {
        return false;
      }

      rowsById.delete(current.id);
      rowIdByConnectionId.delete(connectionId);
      rowIdsByDocId.set(
        current.docId,
        (rowIdsByDocId.get(current.docId) || []).filter((rowId) => rowId !== current.id)
      );

      const runtimeRoom = runtimeSocketsByDocId.get(current.docId);
      if (runtimeRoom) {
        const socket = runtimeRoom.get(connectionId);
        if (socket) {
          runtimeConnectionIdBySocket.delete(socket);
        }
        runtimeRoom.delete(connectionId);
      }

      return true;
    },

    async addSocketToRoom(docId, socket, clientId, metadata = {}) {
      const existingConnId = runtimeConnectionIdBySocket.get(socket);
      let previousEntry = null;

      if (existingConnId) {
        const existingRow = getStoredRowByConnectionId(existingConnId);
        if (existingRow) {
          // 记录前一个 (docId, clientId)，供调用方执行旧身份的 leave 逻辑。
          if (existingRow.docId !== docId || existingRow.clientId !== clientId) {
            previousEntry = { docId: existingRow.docId, clientId: existingRow.clientId };
          }
          // 从旧房间的 runtime 映射中移除，避免断开时遗留脏连接。
          const oldRoom = runtimeSocketsByDocId.get(existingRow.docId);
          if (oldRoom) {
            oldRoom.delete(existingConnId);
          }
        }
      }

      const row = upsert({
        connectionId: existingConnId || undefined,
        docId,
        clientId,
        status: 'connected',
        ...metadata,
      });
      const runtimeRoom = ensureRuntimeRoom(docId);

      runtimeRoom.set(row.connectionId, socket);
      runtimeConnectionIdBySocket.set(socket, row.connectionId);
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

      const current = getStoredRowByConnectionId(connectionId);
      if (!current) {
        runtimeConnectionIdBySocket.delete(socket);
        return null;
      }

      const runtimeRoom = runtimeSocketsByDocId.get(current.docId);
      if (runtimeRoom) {
        runtimeRoom.delete(connectionId);
      }
      runtimeConnectionIdBySocket.delete(socket);

      const nextRow = upsert({
        connectionId,
        status: 'closed',
      });

      return nextRow;
    },

    async close() {},
  };
}

module.exports = createRoomSocketMemoryStore;
