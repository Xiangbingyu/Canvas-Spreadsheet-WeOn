const { createRoomUser } = require('../../domain/entities/roomUser');
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

function createCompositeKey(...parts) {
  return parts.map((part) => String(part ?? '')).join(':');
}

function createRoomUserMemoryStore() {
  const rowsById = new Map();
  const rowIdByDocClient = new Map();
  const rowIdsByDocId = new Map();
  const nextPrimaryId = createAutoIncrement();

  function getKey(docId, clientId) {
    return createCompositeKey(docId, clientId);
  }

  function ensureDocRows(docId) {
    if (!rowIdsByDocId.has(docId)) {
      rowIdsByDocId.set(docId, []);
    }

    return rowIdsByDocId.get(docId);
  }

  function getStoredRow(docId, clientId) {
    const rowId = rowIdByDocClient.get(getKey(docId, clientId));
    return rowId ? rowsById.get(rowId) || null : null;
  }

  function upsert(rowInput = {}) {
    const current = getStoredRow(rowInput.docId, rowInput.clientId);

    if (!current) {
      const row = createRoomUser({
        ...rowInput,
        id: rowInput.id || nextPrimaryId(),
      });

      rowsById.set(row.id, row);
      rowIdByDocClient.set(getKey(row.docId, row.clientId), row.id);
      ensureDocRows(row.docId).push(row.id);
      return cloneRecord(row);
    }

    const nextRow = createRoomUser({
      ...current,
      ...rowInput,
      id: current.id,
      docId: current.docId,
      clientId: current.clientId,
    });

    rowsById.set(current.id, nextRow);
    return cloneRecord(nextRow);
  }

  function listRowsByDocId(docId) {
    return (rowIdsByDocId.get(docId) || [])
      .map((rowId) => rowsById.get(rowId))
      .filter(Boolean)
      .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
  }

  function remove(docId, clientId) {
    const current = getStoredRow(docId, clientId);

    if (!current) {
      return false;
    }

    rowsById.delete(current.id);
    rowIdByDocClient.delete(getKey(docId, clientId));
    rowIdsByDocId.set(
      docId,
      (rowIdsByDocId.get(docId) || []).filter((rowId) => rowId !== current.id)
    );
    return true;
  }

  return {
    type: 'memory',
    tableName: 'room_user',
    rowsById,
    rowIdByDocClient,
    rowIdsByDocId,

    async create(rowInput = {}) {
      return upsert(rowInput);
    },

    async upsert(rowInput = {}) {
      return upsert(rowInput);
    },

    async findByDocIdAndClientId(docId, clientId) {
      return cloneRecord(getStoredRow(docId, clientId));
    },

    async listByDocId(docId) {
      return cloneRecords(listRowsByDocId(docId));
    },

    async deleteByDocIdAndClientId(docId, clientId) {
      return remove(docId, clientId);
    },

    async upsertRoomUser(docId, user) {
      return upsert({
        docId,
        ...user,
      });
    },

    async getRoomUsers(docId) {
      return cloneRecords(listRowsByDocId(docId));
    },

    async removeRoomUser(docId, clientId) {
      return remove(docId, clientId);
    },
  };
}

module.exports = createRoomUserMemoryStore;
