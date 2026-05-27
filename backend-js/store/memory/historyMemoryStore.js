const { createHistory } = require('../../domain/entities/history');
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

function createStoreError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function createCompositeKey(...parts) {
  return parts.map((part) => String(part ?? '')).join(':');
}

function createHistoryMemoryStore() {
  const rowsById = new Map();
  const rowIdByDocSeq = new Map();
  const rowIdByEventId = new Map();
  const rowIdsByDocId = new Map();
  const nextPrimaryId = createAutoIncrement();

  function ensureDocRows(docId) {
    if (!rowIdsByDocId.has(docId)) {
      rowIdsByDocId.set(docId, []);
    }

    return rowIdsByDocId.get(docId);
  }

  function getStoredRowByDocSeq(docId, seq) {
    const rowId = rowIdByDocSeq.get(createCompositeKey(docId, seq));
    return rowId ? rowsById.get(rowId) || null : null;
  }

  function insert(rowInput = {}) {
    const row = createHistory({
      ...rowInput,
      id: rowInput.id || nextPrimaryId(),
    });
    const docSeqKey = createCompositeKey(row.docId, row.seq);

    if (rowIdByDocSeq.has(docSeqKey)) {
      throw createStoreError('HISTORY_DUPLICATE_DOC_SEQ', `history (doc_id, seq) already exists: ${docSeqKey}`, {
        docId: row.docId,
        seq: row.seq,
      });
    }

    if (row.eventId && rowIdByEventId.has(row.eventId)) {
      throw createStoreError('HISTORY_DUPLICATE_EVENT_ID', `history event_id already exists: ${row.eventId}`, {
        eventId: row.eventId,
      });
    }

    rowsById.set(row.id, row);
    rowIdByDocSeq.set(docSeqKey, row.id);
    ensureDocRows(row.docId).push(row.id);

    if (row.eventId) {
      rowIdByEventId.set(row.eventId, row.id);
    }

    return cloneRecord(row);
  }

  function listRowsByDocId(docId) {
    const rowIds = rowIdsByDocId.get(docId) || [];
    return rowIds
      .map((rowId) => rowsById.get(rowId))
      .filter(Boolean)
      .sort((left, right) => left.seq - right.seq);
  }

  return {
    type: 'memory',
    tableName: 'history',
    rowsById,
    rowIdByDocSeq,
    rowIdByEventId,
    rowIdsByDocId,

    async create(rowInput = {}) {
      return insert(rowInput);
    },

    async insert(rowInput = {}) {
      return insert(rowInput);
    },

    async append(rowInput = {}) {
      return insert(rowInput);
    },

    async findByDocIdAndSeq(docId, seq) {
      return cloneRecord(getStoredRowByDocSeq(docId, seq));
    },

    async getBySeq(docId, seq) {
      return cloneRecord(getStoredRowByDocSeq(docId, seq));
    },

    async findByEventId(eventId) {
      const rowId = rowIdByEventId.get(eventId);
      return rowId ? cloneRecord(rowsById.get(rowId)) : null;
    },

    async listByDocId(docId) {
      return cloneRecords(listRowsByDocId(docId));
    },

    async listByDocIdAndClientId(docId, clientId) {
      return cloneRecords(listRowsByDocId(docId).filter((row) => row.clientId === clientId));
    },

    async listBySourceSeq(docId, sourceSeq) {
      return cloneRecords(listRowsByDocId(docId).filter((row) => row.sourceSeq === sourceSeq));
    },
  };
}

module.exports = createHistoryMemoryStore;
