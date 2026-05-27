const { createDoc, normalizeDocSnapshot } = require('../../domain/entities/doc');
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

function createDocMemoryStore() {
  const rowsById = new Map();
  const rowIdByDocId = new Map();
  const nextPrimaryId = createAutoIncrement();
  let docCounter = 0;

  function nextDocId() {
    docCounter += 1;
    return `doc_${String(docCounter).padStart(3, '0')}`;
  }

  function getStoredRowByDocId(docId) {
    const rowId = rowIdByDocId.get(docId);
    return rowId ? rowsById.get(rowId) || null : null;
  }

  function insert(rowInput = {}) {
    const row = createDoc({
      ...rowInput,
      id: rowInput.id || nextPrimaryId(),
      docId: rowInput.docId || nextDocId(),
    });

    if (rowIdByDocId.has(row.docId)) {
      throw createStoreError('DOC_DUPLICATE_DOC_ID', `doc_id already exists: ${row.docId}`, {
        docId: row.docId,
      });
    }

    rowsById.set(row.id, row);
    rowIdByDocId.set(row.docId, row.id);
    return cloneRecord(row);
  }

  function updateByDocId(docId, patch = {}) {
    const current = getStoredRowByDocId(docId);

    if (!current) {
      return null;
    }

    const nextRow = createDoc({
      ...current,
      ...patch,
      id: current.id,
      docId: current.docId,
    });

    rowsById.set(current.id, nextRow);
    return cloneRecord(nextRow);
  }

  function upsert(rowInput = {}) {
    const current = rowInput.docId ? getStoredRowByDocId(rowInput.docId) : null;

    if (!current) {
      return insert(rowInput);
    }

    return updateByDocId(current.docId, rowInput);
  }

  return {
    type: 'memory',
    tableName: 'doc',
    rowsById,
    rowIdByDocId,

    async create(rowInput = {}) {
      return insert(rowInput);
    },

    async insert(rowInput = {}) {
      return insert(rowInput);
    },

    async upsert(rowInput = {}) {
      return upsert(rowInput);
    },

    async findByDocId(docId) {
      return cloneRecord(getStoredRowByDocId(docId));
    },

    async getByDocId(docId) {
      return this.findByDocId(docId);
    },

    async list() {
      return cloneRecords(Array.from(rowsById.values()));
    },

    async updateByDocId(docId, patch = {}) {
      return updateByDocId(docId, patch);
    },

    async updateSnapshot(docId, snapshotJson, currentSeq, updatedAt) {
      return updateByDocId(docId, {
        snapshotJson: normalizeDocSnapshot(snapshotJson),
        currentSeq,
        updatedAt,
      });
    },

    async createDoc(rowInput = {}) {
      return insert(rowInput);
    },

    async getDocState(docId) {
      return cloneRecord(getStoredRowByDocId(docId));
    },

    async applySetCell(command) {
      const current = getStoredRowByDocId(command.docId);

      if (!current) {
        return null;
      }

      const nextSnapshot = normalizeDocSnapshot(current.snapshotJson);
      const cellKey = `${command.row}:${command.col}`;
      const previousCell = nextSnapshot.cells[cellKey] || {};
      const oldValue = previousCell.value ?? '';
      const oldStyle = previousCell.style ?? null;

      nextSnapshot.cells[cellKey] = {
        value: command.value ?? '',
        // style 显式传 null 表示清除样式；未传（undefined）时保留旧样式。
        style: command.style !== undefined ? command.style : (previousCell.style ?? null),
      };

      if (command.row > nextSnapshot.rowCount) {
        nextSnapshot.rowCount = command.row;
      }

      if (command.col > nextSnapshot.colCount) {
        nextSnapshot.colCount = command.col;
      }

      const updatedDoc = updateByDocId(command.docId, {
        snapshotJson: nextSnapshot,
        currentSeq: Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1,
      });

      if (!updatedDoc) return null;

      return { ...updatedDoc, _before: { value: oldValue, style: oldStyle } };
    },

    async applyImportSheet(command) {
      const current = getStoredRowByDocId(command.docId);

      if (!current) {
        return null;
      }

      return updateByDocId(command.docId, {
        snapshotJson: normalizeDocSnapshot(command.snapshotJson || command.snapshot),
        currentSeq: Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1,
      });
    },

    // 同步批量写入种子数据，仅供 store 初始化时调用。
    // 种子使用固定 docId，不经过 nextDocId()，不影响自增计数器。
    seedSync(rows = []) {
      for (const row of rows) {
        insert(row);
      }
    },
  };
}

module.exports = createDocMemoryStore;
