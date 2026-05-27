const { createUserOpState } = require('../../domain/entities/userOpState');
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

function createUserOpStateMemoryStore() {
  const rowsById = new Map();
  const rowIdByDocClient = new Map();
  const nextPrimaryId = createAutoIncrement();

  function getKey(docId, clientId) {
    return createCompositeKey(docId, clientId);
  }

  function getStoredRow(docId, clientId) {
    const rowId = rowIdByDocClient.get(getKey(docId, clientId));
    return rowId ? rowsById.get(rowId) || null : null;
  }

  function upsert(rowInput = {}) {
    const current = getStoredRow(rowInput.docId, rowInput.clientId);

    if (!current) {
      const row = createUserOpState({
        ...rowInput,
        id: rowInput.id || nextPrimaryId(),
      });

      rowsById.set(row.id, row);
      rowIdByDocClient.set(getKey(row.docId, row.clientId), row.id);
      return cloneRecord(row);
    }

    const nextRow = createUserOpState({
      ...current,
      ...rowInput,
      id: current.id,
      docId: current.docId,
      clientId: current.clientId,
    });

    rowsById.set(current.id, nextRow);
    return cloneRecord(nextRow);
  }

  return {
    type: 'memory',
    tableName: 'user_op_state',
    rowsById,
    rowIdByDocClient,

    async create(rowInput = {}) {
      return upsert(rowInput);
    },

    async upsert(rowInput = {}) {
      return upsert(rowInput);
    },

    async findByDocIdAndClientId(docId, clientId) {
      return cloneRecord(getStoredRow(docId, clientId));
    },

    async list() {
      return cloneRecords(Array.from(rowsById.values()));
    },

    async getState(docId, clientId) {
      return cloneRecord(getStoredRow(docId, clientId));
    },

    async saveState(state) {
      return upsert(state);
    },
  };
}

module.exports = createUserOpStateMemoryStore;
