const { ERROR_CODES } = require('../protocol/errorCodes');

const STRUCTURE_OP_TYPES = new Set([
  'insert_row',
  'delete_row',
  'insert_col',
  'delete_col',
]);

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isValidBaseSeq(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeBaseSeq(baseSeq) {
  return isValidBaseSeq(baseSeq) ? baseSeq : null;
}

function shouldTreatAsOtBarrier(historyEntry) {
  return historyEntry && historyEntry.opType === 'import_sheet';
}

function isStructureTransformEntry(historyEntry) {
  return historyEntry && STRUCTURE_OP_TYPES.has(historyEntry.opType);
}

function getSheetSnapshot(doc, sheetId) {
  const snapshot = doc && doc.snapshotJson ? doc.snapshotJson : {};
  const sheets = snapshot.sheets || {};
  return sheetId && sheets[sheetId] ? sheets[sheetId] : null;
}

function clampPosition(value, upperBound) {
  const normalizedUpperBound = Number.isInteger(upperBound) && upperBound > 0 ? upperBound : 1;
  return Math.max(1, Math.min(value, normalizedUpperBound));
}

function transformCellReferenceThroughHistory({
  sheetId,
  row,
  col,
  historyEntries,
  currentDoc,
}) {
  let nextRow = row;
  let nextCol = col;

  for (const historyEntry of historyEntries) {
    if (!isStructureTransformEntry(historyEntry)) {
      continue;
    }

    if ((historyEntry.targetSheetId || null) !== (sheetId || null)) {
      continue;
    }

    if (historyEntry.opType === 'insert_row' && Number.isInteger(historyEntry.targetRow)) {
      if (nextRow >= historyEntry.targetRow) {
        nextRow += 1;
      }
      continue;
    }

    if (historyEntry.opType === 'delete_row' && Number.isInteger(historyEntry.targetRow)) {
      if (nextRow > historyEntry.targetRow) {
        nextRow -= 1;
      }
      continue;
    }

    if (historyEntry.opType === 'insert_col' && Number.isInteger(historyEntry.targetCol)) {
      if (nextCol >= historyEntry.targetCol) {
        nextCol += 1;
      }
      continue;
    }

    if (historyEntry.opType === 'delete_col' && Number.isInteger(historyEntry.targetCol)) {
      if (nextCol > historyEntry.targetCol) {
        nextCol -= 1;
      }
    }
  }

  const currentSheet = getSheetSnapshot(currentDoc, sheetId);

  if (currentSheet) {
    nextRow = clampPosition(nextRow, currentSheet.rowCount);
    nextCol = clampPosition(nextCol, currentSheet.colCount);
  }

  return {
    sheetId,
    row: nextRow,
    col: nextCol,
  };
}

async function rebaseSetCellCommand({
  command,
  currentDoc,
  historyStore,
  connection = null,
}) {
  const normalizedBaseSeq = normalizeBaseSeq(command.baseSeq);

  if (normalizedBaseSeq === null) {
    return {
      command: {
        ...command,
        baseSeq: null,
      },
      rebaseResult: {
        enabled: false,
        rebased: false,
        baseSeq: null,
        conflictSeq: null,
      },
    };
  }

  if (normalizedBaseSeq > currentDoc.currentSeq) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'baseSeq is ahead of current document version', {
      docId: command.docId,
      baseSeq: normalizedBaseSeq,
      currentSeq: currentDoc.currentSeq,
    });
  }

  if (normalizedBaseSeq === currentDoc.currentSeq) {
    return {
      command: {
        ...command,
        baseSeq: normalizedBaseSeq,
      },
      rebaseResult: {
        enabled: true,
        rebased: false,
        baseSeq: normalizedBaseSeq,
        conflictSeq: null,
      },
    };
  }

  const historyEntries = await historyStore.listByDocIdSeqRange(
    command.docId,
    normalizedBaseSeq,
    currentDoc.currentSeq,
    { connection }
  );
  const barrierEntry = historyEntries.find((entry) => shouldTreatAsOtBarrier(entry));

  if (barrierEntry) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'document changed by import_sheet, please refresh and retry', {
      docId: command.docId,
      baseSeq: normalizedBaseSeq,
      currentSeq: currentDoc.currentSeq,
      conflictSeq: barrierEntry.seq,
      conflictOpType: barrierEntry.opType,
    });
  }

  const transformedTarget = transformCellReferenceThroughHistory({
    sheetId: command.sheetId,
    row: command.row,
    col: command.col,
    historyEntries,
    currentDoc,
  });

  return {
    command: {
      ...command,
      baseSeq: normalizedBaseSeq,
      row: transformedTarget.row,
      col: transformedTarget.col,
    },
    rebaseResult: {
      enabled: true,
      rebased: true,
      baseSeq: normalizedBaseSeq,
      conflictSeq: null,
    },
  };
}

async function rebaseBatchSetCellCommand({
  command,
  currentDoc,
  historyStore,
  connection = null,
}) {
  const normalizedBaseSeq = normalizeBaseSeq(command.baseSeq);

  if (normalizedBaseSeq === null) {
    return {
      command: {
        ...command,
        baseSeq: null,
      },
      rebaseResult: {
        enabled: false,
        rebased: false,
        baseSeq: null,
        conflictSeq: null,
      },
    };
  }

  if (normalizedBaseSeq > currentDoc.currentSeq) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'baseSeq is ahead of current document version', {
      docId: command.docId,
      baseSeq: normalizedBaseSeq,
      currentSeq: currentDoc.currentSeq,
    });
  }

  if (normalizedBaseSeq === currentDoc.currentSeq) {
    return {
      command: {
        ...command,
        baseSeq: normalizedBaseSeq,
      },
      rebaseResult: {
        enabled: true,
        rebased: false,
        baseSeq: normalizedBaseSeq,
        conflictSeq: null,
      },
    };
  }

  const historyEntries = await historyStore.listByDocIdSeqRange(
    command.docId,
    normalizedBaseSeq,
    currentDoc.currentSeq,
    { connection }
  );
  const barrierEntry = historyEntries.find((entry) => shouldTreatAsOtBarrier(entry));

  if (barrierEntry) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'document changed by import_sheet, please refresh and retry', {
      docId: command.docId,
      baseSeq: normalizedBaseSeq,
      currentSeq: currentDoc.currentSeq,
      conflictSeq: barrierEntry.seq,
      conflictOpType: barrierEntry.opType,
    });
  }

  return {
    command: {
      ...command,
      baseSeq: normalizedBaseSeq,
      updates: (command.updates || []).map((update) => {
        const transformedTarget = transformCellReferenceThroughHistory({
          sheetId: command.sheetId,
          row: update.row,
          col: update.col,
          historyEntries,
          currentDoc,
        });

        return {
          ...update,
          row: transformedTarget.row,
          col: transformedTarget.col,
        };
      }),
    },
    rebaseResult: {
      enabled: true,
      rebased: true,
      baseSeq: normalizedBaseSeq,
      conflictSeq: null,
    },
  };
}

module.exports = {
  normalizeBaseSeq,
  shouldTreatAsOtBarrier,
  transformCellReferenceThroughHistory,
  rebaseSetCellCommand,
  rebaseBatchSetCellCommand,
};
