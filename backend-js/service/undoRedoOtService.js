const { ERROR_CODES } = require('../protocol/errorCodes');
const { shouldTreatAsOtBarrier } = require('./cellOtService');

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

function getCurrentCellState(doc, row, col) {
  const snapshot = doc && doc.snapshotJson ? doc.snapshotJson : {};
  const cells = snapshot.cells || {};
  const styles = snapshot.styles || {};
  const cell = cells[`${row}:${col}`] || {};
  const styleId = typeof cell.styleId === 'string' ? cell.styleId : null;

  return normalizeCellState({
    value: cell.value ?? '',
    style: styleId ? styles[styleId] || null : null,
  });
}

function isSameCellTouched(historyEntry, row, col) {
  return historyEntry
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

  const currentState = getCurrentCellState(currentDoc, entry.row, entry.col);
  const normalizedDesiredState = normalizeCellState(desiredState);

  if (referenceSeq === currentDoc.currentSeq) {
    return {
      sourceSeq: referenceSeq,
      baseSeq: currentDoc.currentSeq,
      rebased: false,
      noop: areCellStatesEqual(currentState, normalizedDesiredState),
      currentState,
      targetState: normalizedDesiredState,
      conflictSeq: null,
    };
  }

  const historyEntries = await historyStore.listByDocIdSeqRange(
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

  const sameCellTouched = historyEntries.some((historyEntry) => isSameCellTouched(historyEntry, entry.row, entry.col));
  const targetState = sameCellTouched ? currentState : normalizedDesiredState;

  return {
    sourceSeq: referenceSeq,
    baseSeq: currentDoc.currentSeq,
    rebased: true,
    noop: sameCellTouched || areCellStatesEqual(currentState, targetState),
    currentState,
    targetState,
    conflictSeq: null,
  };
}

function createAppliedStackEntry({
  sourceSeq,
  docId,
  clientId,
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
  row,
  col,
  beforeState,
  afterState,
}) {
  return createAppliedStackEntry({
    sourceSeq,
    docId,
    clientId,
    row,
    col,
    beforeState: afterState,
    afterState: beforeState,
  });
}

module.exports = {
  normalizeCellState,
  resolveUndoRedoOperation,
  createAppliedStackEntry,
  createRedoStackEntry,
};
