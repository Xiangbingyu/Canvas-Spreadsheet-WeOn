const { createUserOpState } = require('../../domain/entities/userOpState');
const { deepClone } = require('../../utils/clone');
const collabConfig = require('../../config/collabConfig');

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

function getRetentionTtlMs() {
  return Number.isInteger(collabConfig.userOpStateTtlMs) && collabConfig.userOpStateTtlMs > 0
    ? collabConfig.userOpStateTtlMs
    : 30 * 60 * 1000;
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

  function deleteStoredRow(docId, clientId) {
    const key = getKey(docId, clientId);
    const rowId = rowIdByDocClient.get(key);

    if (!rowId) {
      return false;
    }

    rowIdByDocClient.delete(key);
    rowsById.delete(rowId);
    return true;
  }

  function purgeExpiredRows() {
    const ttlMs = getRetentionTtlMs();
    const now = Date.now();

    for (const row of rowsById.values()) {
      const updatedAtMs = Date.parse(row.updatedAt);

      if (Number.isNaN(updatedAtMs)) {
        continue;
      }

      if (now - updatedAtMs > ttlMs) {
        deleteStoredRow(row.docId, row.clientId);
      }
    }
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
      purgeExpiredRows();
      return cloneRecord(getStoredRow(docId, clientId));
    },

    async list() {
      purgeExpiredRows();
      return cloneRecords(Array.from(rowsById.values()));
    },

    async getState(docId, clientId) {
      purgeExpiredRows();
      return cloneRecord(getStoredRow(docId, clientId));
    },

    async saveState(state) {
      purgeExpiredRows();
      return upsert(state);
    },

    async deleteByDocIdAndClientId(docId, clientId) {
      purgeExpiredRows();
      return deleteStoredRow(docId, clientId);
    },

    async purgeExpired() {
      purgeExpiredRows();
      return cloneRecords(Array.from(rowsById.values()));
    },
  };
}

module.exports = createUserOpStateMemoryStore;
