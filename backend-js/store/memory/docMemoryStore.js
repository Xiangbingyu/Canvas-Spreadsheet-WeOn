const {
  createDoc,
  normalizeDocSnapshot,
  createEmptySheetSnapshot,
  buildNextSheetId,
  buildDefaultSheetName,
} = require('../../domain/entities/doc');
const { deepClone } = require('../../utils/clone');
const { applySheetStructureChangeToSnapshot } = require('../../utils/sheetStructure');

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function createStyleKey(style) {
  return stableStringify(style);
}

function nextStyleId(sheet) {
  const existingIds = Object.keys(sheet.styles || {});
  let maxStyleNumber = 0;

  for (const id of existingIds) {
    const match = /^style_(\d+)$/.exec(id);
    if (match) {
      maxStyleNumber = Math.max(maxStyleNumber, Number(match[1]));
    }
  }

  return `style_${String(maxStyleNumber + 1).padStart(3, '0')}`;
}

function findOrCreateStyleId(sheet, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return null;
  }

  const styleKey = createStyleKey(style);

  for (const [styleId, styleValue] of Object.entries(sheet.styles || {})) {
    if (createStyleKey(styleValue) === styleKey) {
      return styleId;
    }
  }

  const styleId = nextStyleId(sheet);
  sheet.styles[styleId] = deepClone(style);
  return styleId;
}

function resolveTargetSheet(nextSnapshot, preferredSheetId = null) {
  const requestedSheetId = typeof preferredSheetId === 'string' && preferredSheetId
    ? preferredSheetId
    : nextSnapshot.activeSheetId;

  if (!requestedSheetId || !nextSnapshot.sheets || !nextSnapshot.sheets[requestedSheetId]) {
    return {
      sheetId: null,
      sheet: null,
    };
  }

  return {
    sheetId: requestedSheetId,
    sheet: nextSnapshot.sheets[requestedSheetId],
  };
}

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

    async getMaxDocNumericId() {
      let maxDocNumericId = 0;

      for (const row of rowsById.values()) {
        const match = /^doc_(\d+)$/.exec(typeof row.docId === 'string' ? row.docId : '');
        if (!match) {
          continue;
        }

        maxDocNumericId = Math.max(maxDocNumericId, Number.parseInt(match[1], 10));
      }

      return maxDocNumericId;
    },

    async updateByDocId(docId, patch = {}) {
      return updateByDocId(docId, patch);
    },

    async updateSnapshot(docId, snapshotJson, currentSeq, updatedAt) {
      return updateByDocId(docId, {
        snapshotJson: normalizeDocSnapshot(snapshotJson, { docId }),
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

      const nextSnapshot = normalizeDocSnapshot(current.snapshotJson, { docId: command.docId });
      const { sheetId: targetSheetId, sheet: targetSheet } = resolveTargetSheet(nextSnapshot, command.sheetId);

      if (!targetSheetId || !targetSheet) {
        return null;
      }

      const cellKey = `${command.row}:${command.col}`;
      const previousCell = targetSheet.cells[cellKey] || {};
      const oldValue = previousCell.value ?? '';
      const oldStyleId = typeof previousCell.styleId === 'string' ? previousCell.styleId : null;
      const oldStyle = oldStyleId ? deepClone(targetSheet.styles[oldStyleId] || null) : null;
      const nextStyleIdValue = command.style !== undefined
        ? findOrCreateStyleId(targetSheet, command.style)
        : null;

      targetSheet.cells[cellKey] = {
        row: command.row,
        col: command.col,
        value: command.value ?? '',
        // style 显式传 null 或未传（undefined）都表示清除样式。
        styleId: nextStyleIdValue,
      };

      if (command.row > targetSheet.rowCount) {
        targetSheet.rowCount = command.row;
      }

      if (command.col > targetSheet.colCount) {
        targetSheet.colCount = command.col;
      }

      const updatedDoc = updateByDocId(command.docId, {
        snapshotJson: nextSnapshot,
        currentSeq: Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1,
      });

      if (!updatedDoc) return null;

      return {
        ...updatedDoc,
        _before: { value: oldValue, style: oldStyle },
        _targetSheetId: targetSheetId,
      };
    },

    async applyBatchSetCell(command) {
      const current = getStoredRowByDocId(command.docId);

      if (!current) {
        return null;
      }

      const nextSnapshot = normalizeDocSnapshot(current.snapshotJson, { docId: command.docId });
      const { sheetId: targetSheetId, sheet: targetSheet } = resolveTargetSheet(nextSnapshot, command.sheetId);

      if (!targetSheetId || !targetSheet) {
        return null;
      }

      const appliedUpdates = [];

      for (const update of command.updates || []) {
        const cellKey = `${update.row}:${update.col}`;
        const previousCell = targetSheet.cells[cellKey] || {};
        const oldValue = previousCell.value ?? '';
        const oldStyleId = typeof previousCell.styleId === 'string' ? previousCell.styleId : null;
        const oldStyle = oldStyleId ? deepClone(targetSheet.styles[oldStyleId] || null) : null;
        const hasValuePatch = update.value !== undefined;
        const hasStylePatch = update.style !== undefined;
        const nextValue = hasValuePatch ? update.value : oldValue;
        const nextStyle = hasStylePatch ? update.style : oldStyle;
        const nextStyleIdValue = hasStylePatch
          ? findOrCreateStyleId(targetSheet, nextStyle)
          : oldStyleId;

        targetSheet.cells[cellKey] = {
          row: update.row,
          col: update.col,
          value: nextValue,
          styleId: nextStyleIdValue,
        };

        if (update.row > targetSheet.rowCount) {
          targetSheet.rowCount = update.row;
        }

        if (update.col > targetSheet.colCount) {
          targetSheet.colCount = update.col;
        }

        appliedUpdates.push({
          row: update.row,
          col: update.col,
          oldValue,
          oldStyle,
          newValue: nextValue,
          newStyle: nextStyle,
        });
      }

      const updatedDoc = updateByDocId(command.docId, {
        snapshotJson: nextSnapshot,
        currentSeq: Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1,
      });

      if (!updatedDoc) {
        return null;
      }

      return {
        ...updatedDoc,
        _targetSheetId: targetSheetId,
        _batchUpdates: appliedUpdates,
      };
    },

    async applySetTitle(command) {
      const current = getStoredRowByDocId(command.docId);

      if (!current) {
        return null;
      }

      const updatedDoc = updateByDocId(command.docId, {
        title: command.title,
        currentSeq: Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1,
      });

      if (!updatedDoc) {
        return null;
      }

      return { ...updatedDoc, _before: { title: current.title } };
    },

    async applySheetStructureChange(command) {
      const current = getStoredRowByDocId(command.docId);

      if (!current) {
        return null;
      }

      const structureResult = applySheetStructureChangeToSnapshot(current.snapshotJson, {
        docId: command.docId,
        sheetId: command.sheetId,
        opType: command.opType,
        row: command.row,
        col: command.col,
      });

      if (!structureResult.ok || !structureResult.targetSheetId) {
        return null;
      }

      const updatedDoc = updateByDocId(command.docId, {
        snapshotJson: structureResult.nextSnapshot,
        currentSeq: Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1,
      });

      if (!updatedDoc) {
        return null;
      }

      return {
        ...updatedDoc,
        _targetSheetId: structureResult.targetSheetId,
        _structureChange: {
          opType: command.opType,
          row: Number.isInteger(command.row) ? command.row : null,
          col: Number.isInteger(command.col) ? command.col : null,
        },
      };
    },

    async applyImportSheet(command) {
      const current = getStoredRowByDocId(command.docId);

      if (!current) {
        return null;
      }

      return updateByDocId(command.docId, {
        snapshotJson: normalizeDocSnapshot(command.snapshotJson || command.snapshot, { docId: command.docId }),
        currentSeq: Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1,
      });
    },

    async applyAddSheet(command) {
      const current = getStoredRowByDocId(command.docId);

      if (!current) {
        return null;
      }

      const nextSnapshot = normalizeDocSnapshot(current.snapshotJson, { docId: command.docId });
      const nextSheetId = buildNextSheetId(nextSnapshot, command.docId);
      const nextSheet = createEmptySheetSnapshot({
        docId: command.docId,
        sheetId: nextSheetId,
        name: command.sheetName || buildDefaultSheetName(nextSnapshot),
      });

      nextSnapshot.sheets[nextSheetId] = nextSheet;
      nextSnapshot.sheetOrder = [...(nextSnapshot.sheetOrder || []), nextSheetId];
      nextSnapshot.activeSheetId = nextSheetId;

      const updatedDoc = updateByDocId(command.docId, {
        snapshotJson: nextSnapshot,
        currentSeq: Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1,
      });

      if (!updatedDoc) {
        return null;
      }

      return {
        ...updatedDoc,
        _addedSheet: deepClone(nextSheet),
      };
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
