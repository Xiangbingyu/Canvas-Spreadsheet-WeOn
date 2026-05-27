const { createAuditLog } = require('../../domain/entities/auditLog');
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

function createAuditLogMemoryStore() {
  const rowsById = new Map();
  const rowIds = [];
  const nextPrimaryId = createAutoIncrement();

  function insert(rowInput = {}) {
    const row = createAuditLog({
      ...rowInput,
      id: rowInput.id || nextPrimaryId(),
    });

    rowsById.set(row.id, row);
    rowIds.push(row.id);
    return cloneRecord(row);
  }

  function listRows() {
    return rowIds
      .map((rowId) => rowsById.get(rowId))
      .filter(Boolean)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  return {
    type: 'memory',
    tableName: 'audit_log',
    rowsById,
    rowIds,

    async create(rowInput = {}) {
      return insert(rowInput);
    },

    async insert(rowInput = {}) {
      return insert(rowInput);
    },

    async append(rowInput = {}) {
      return insert(rowInput);
    },

    async list() {
      return cloneRecords(listRows());
    },

    async listByDocId(docId) {
      return cloneRecords(listRows().filter((row) => row.docId === docId));
    },

    async listByClientId(clientId) {
      return cloneRecords(listRows().filter((row) => row.clientId === clientId));
    },

    async listByEventType(eventType) {
      return cloneRecords(listRows().filter((row) => row.eventType === eventType));
    },
  };
}

module.exports = createAuditLogMemoryStore;
