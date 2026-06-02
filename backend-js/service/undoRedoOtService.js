const { ERROR_CODES } = require('../protocol/errorCodes');
const {
  shouldTreatAsOtBarrier,
  transformCellReferenceThroughHistory,
} = require('./cellOtService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function cloneStyle(style) {
  if (style === undefined || style === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(style));
}

function normalizeCellState(state = {}) {
  return {
    value: state.value ?? '',
    style: cloneStyle(state.style),
  };
}

function resolveSheetFromDoc(doc, preferredSheetId = null) {
  const snapshot = doc && doc.snapshotJson ? doc.snapshotJson : {};
  const hasPreferredSheetId = typeof preferredSheetId === 'string' && preferredSheetId;
  const requestedSheetId = hasPreferredSheetId ? preferredSheetId : snapshot.activeSheetId;
  const sheets = snapshot.sheets || {};
  const sheetId = requestedSheetId && sheets[requestedSheetId]
    ? requestedSheetId
    : (hasPreferredSheetId ? null : Object.keys(sheets)[0]);
  const sheet = sheetId ? sheets[sheetId] || null : null;

  return {
    requestedSheetId,
    sheetId: sheet ? sheet.id : null,
    sheet: sheet || null,
  };
}

function getCurrentCellState(doc, row, col, sheetId = null) {
  const { sheet, requestedSheetId } = resolveSheetFromDoc(doc, sheetId);

  if (!sheet && requestedSheetId) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${requestedSheetId}`, {
      docId: doc && doc.docId ? doc.docId : null,
      sheetId: requestedSheetId,
    });
  }

  const cells = sheet && sheet.cells ? sheet.cells : {};
  const styles = sheet && sheet.styles ? sheet.styles : {};
  const cell = cells[`${row}:${col}`] || {};
  const styleId = typeof cell.styleId === 'string' ? cell.styleId : null;

  return normalizeCellState({
    value: cell.value ?? '',
    style: styleId ? styles[styleId] || null : null,
  });
}

function isSameCellTouched(historyEntry, sheetId, row, col) {
  return historyEntry
    && (historyEntry.targetSheetId || null) === (sheetId || null)
    && historyEntry.targetRow === row
    && historyEntry.targetCol === col;
}

function areCellStatesEqual(left, right) {
  return JSON.stringify(normalizeCellState(left)) === JSON.stringify(normalizeCellState(right));
}

async function resolveUndoRedoOperation({
  docId,
  entry,
  desiredState,
  currentDoc,
  historyStore,
  historySource = null,
  connection = null,
}) {
  const referenceSeq = Number(entry && entry.sourceSeq);

  if (!Number.isInteger(referenceSeq) || referenceSeq <= 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'undo/redo sourceSeq is invalid', {
      docId,
      sourceSeq: entry ? entry.sourceSeq : null,
    });
  }

  if (referenceSeq > currentDoc.currentSeq) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'undo/redo sourceSeq is ahead of current document version', {
      docId,
      sourceSeq: referenceSeq,
      currentSeq: currentDoc.currentSeq,
    });
  }

  if (referenceSeq === currentDoc.currentSeq) {
    const currentState = getCurrentCellState(currentDoc, entry.row, entry.col, entry.sheetId);
    const normalizedDesiredState = normalizeCellState(desiredState);

    return {
      sheetId: entry.sheetId || null,
      row: entry.row,
      col: entry.col,
      sourceSeq: referenceSeq,
      baseSeq: currentDoc.currentSeq,
      rebased: false,
      noop: areCellStatesEqual(currentState, normalizedDesiredState),
      currentState,
      targetState: normalizedDesiredState,
      conflictSeq: null,
    };
  }

  if (historySource && typeof historySource.getCheckpoint === 'function') {
    const checkpoint = await historySource.getCheckpoint(docId);
    if (checkpoint !== null && referenceSeq < checkpoint) {
      throw createServiceError(ERROR_CODES.CONFLICT, 'undo/redo sourceSeq is too old, please refresh', {
        docId,
        sourceSeq: referenceSeq,
        checkpoint,
      });
    }
  }

  const historyEntries = historySource
    ? await historySource.readStreamRange(docId, referenceSeq, currentDoc.currentSeq)
    : await historyStore.listByDocIdSeqRange(
      docId,
      referenceSeq,
      currentDoc.currentSeq,
      { connection }
    );
  const barrierEntry = historyEntries.find((historyEntry) => shouldTreatAsOtBarrier(historyEntry));

  if (barrierEntry) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'document changed by import_sheet, please refresh and retry', {
      docId,
      sourceSeq: referenceSeq,
      currentSeq: currentDoc.currentSeq,
      conflictSeq: barrierEntry.seq,
      conflictOpType: barrierEntry.opType,
    });
  }

  const normalizedDesiredState = normalizeCellState(desiredState);
  const transformedTarget = transformCellReferenceThroughHistory({
    sheetId: entry.sheetId || null,
    row: entry.row,
    col: entry.col,
    historyEntries,
    currentDoc,
  });
  const transformedCurrentState = getCurrentCellState(
    currentDoc,
    transformedTarget.row,
    transformedTarget.col,
    transformedTarget.sheetId
  );
  const sameCellTouched = historyEntries.some((historyEntry) => (
    isSameCellTouched(historyEntry, transformedTarget.sheetId, transformedTarget.row, transformedTarget.col)
  ));
  const targetState = sameCellTouched ? transformedCurrentState : normalizedDesiredState;

  return {
    sheetId: transformedTarget.sheetId,
    row: transformedTarget.row,
    col: transformedTarget.col,
    sourceSeq: referenceSeq,
    baseSeq: currentDoc.currentSeq,
    rebased: true,
    noop: sameCellTouched || areCellStatesEqual(transformedCurrentState, targetState),
    currentState: transformedCurrentState,
    targetState,
    conflictSeq: null,
  };
}

function createAppliedStackEntry({
  sourceSeq,
  docId,
  clientId,
  sheetId = null,
  row,
  col,
  beforeState,
  afterState,
}) {
  const normalizedBeforeState = normalizeCellState(beforeState);
  const normalizedAfterState = normalizeCellState(afterState);

  return {
    sourceSeq,
    docId,
    clientId,
    opType: 'set_cell',
    sheetId,
    row,
    col,
    oldValue: normalizedBeforeState.value,
    oldStyle: normalizedBeforeState.style,
    newValue: normalizedAfterState.value,
    newStyle: normalizedAfterState.style,
  };
}

function createRedoStackEntry({
  sourceSeq,
  docId,
  clientId,
  sheetId = null,
  row,
  col,
  beforeState,
  afterState,
}) {
  return createAppliedStackEntry({
    sourceSeq,
    docId,
    clientId,
    sheetId,
    row,
    col,
    beforeState: afterState,
    afterState: beforeState,
  });
}

function transformBatchUpdatesThroughHistory({
  entry,
  historyEntries,
  currentDoc,
}) {
  return (entry.updates || []).map((update) => {
    const transformedTarget = transformCellReferenceThroughHistory({
      sheetId: entry.sheetId || null,
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
  });
}

async function resolveUndoRedoBatchOperation({
  docId,
  entry,
  currentDoc,
  historyStore,
  historySource = null,
  connection = null,
  direction = 'undo',
}) {
  const referenceSeq = Number(entry && entry.sourceSeq);

  if (!Number.isInteger(referenceSeq) || referenceSeq <= 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'undo/redo sourceSeq is invalid', {
      docId,
      sourceSeq: entry ? entry.sourceSeq : null,
    });
  }

  if (referenceSeq > currentDoc.currentSeq) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'undo/redo sourceSeq is ahead of current document version', {
      docId,
      sourceSeq: referenceSeq,
      currentSeq: currentDoc.currentSeq,
    });
  }

  const normalizedUpdates = Array.isArray(entry.updates) ? entry.updates : [];

  if (referenceSeq === currentDoc.currentSeq) {
    return {
      sheetId: entry.sheetId || null,
      sourceSeq: referenceSeq,
      baseSeq: currentDoc.currentSeq,
      rebased: false,
      updates: normalizedUpdates.map((update) => ({
        row: update.row,
        col: update.col,
        value: direction === 'undo' ? update.oldValue : update.newValue,
        style: direction === 'undo' ? update.oldStyle : update.newStyle,
      })),
    };
  }

  if (historySource && typeof historySource.getCheckpoint === 'function') {
    const checkpoint = await historySource.getCheckpoint(docId);
    if (checkpoint !== null && referenceSeq < checkpoint) {
      throw createServiceError(ERROR_CODES.CONFLICT, 'undo/redo sourceSeq is too old, please refresh', {
        docId,
        sourceSeq: referenceSeq,
        checkpoint,
      });
    }
  }

  const historyEntries = historySource
    ? await historySource.readStreamRange(docId, referenceSeq, currentDoc.currentSeq)
    : await historyStore.listByDocIdSeqRange(
      docId,
      referenceSeq,
      currentDoc.currentSeq,
      { connection }
    );
  const barrierEntry = historyEntries.find((historyEntry) => shouldTreatAsOtBarrier(historyEntry));

  if (barrierEntry) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'document changed by import_sheet, please refresh and retry', {
      docId,
      sourceSeq: referenceSeq,
      currentSeq: currentDoc.currentSeq,
      conflictSeq: barrierEntry.seq,
      conflictOpType: barrierEntry.opType,
    });
  }

  const transformedUpdates = transformBatchUpdatesThroughHistory({
    entry,
    historyEntries,
    currentDoc,
  });
  const dedupedByPosition = new Map();

  for (let index = 0; index < transformedUpdates.length; index += 1) {
    const transformed = transformedUpdates[index];
    const original = normalizedUpdates[index];
    dedupedByPosition.set(`${transformed.row}:${transformed.col}`, {
      row: transformed.row,
      col: transformed.col,
      oldValue: original.oldValue,
      oldStyle: original.oldStyle,
      newValue: original.newValue,
      newStyle: original.newStyle,
    });
  }

  return {
    sheetId: entry.sheetId || null,
    sourceSeq: referenceSeq,
    baseSeq: currentDoc.currentSeq,
    rebased: true,
    updates: Array.from(dedupedByPosition.values()).map((update) => ({
      row: update.row,
      col: update.col,
      value: direction === 'undo' ? update.oldValue : update.newValue,
      style: direction === 'undo' ? update.oldStyle : update.newStyle,
      oldValue: update.oldValue,
      oldStyle: update.oldStyle,
      newValue: update.newValue,
      newStyle: update.newStyle,
    })),
  };
}

function createAppliedBatchStackEntry({
  sourceSeq,
  docId,
  clientId,
  sheetId = null,
  baseSeq = null,
  patch = {},
  updates = [],
}) {
  return {
    sourceSeq,
    docId,
    clientId,
    opType: 'batch_set_cell',
    sheetId,
    baseSeq,
    patch: JSON.parse(JSON.stringify(patch)),
    updates: JSON.parse(JSON.stringify(updates)),
  };
}

function createRedoBatchStackEntry({
  sourceSeq,
  docId,
  clientId,
  sheetId = null,
  baseSeq = null,
  patch = {},
  updates = [],
}) {
  return createAppliedBatchStackEntry({
    sourceSeq,
    docId,
    clientId,
    sheetId,
    baseSeq,
    patch,
    updates: updates.map((update) => ({
      row: update.row,
      col: update.col,
      oldValue: update.newValue,
      oldStyle: update.newStyle,
      newValue: update.oldValue,
      newStyle: update.oldStyle,
    })),
  });
}

module.exports = {
  normalizeCellState,
  resolveUndoRedoOperation,
  resolveUndoRedoBatchOperation,
  createAppliedStackEntry,
  createRedoStackEntry,
  createAppliedBatchStackEntry,
  createRedoBatchStackEntry,
};
