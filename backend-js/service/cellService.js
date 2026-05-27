const { ERROR_CODES } = require('../protocol/errorCodes');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isValidCellPosition(value) {
  return Number.isInteger(value) && value >= 1;
}

function normalizeSetCellCommand(command = {}) {
  const { docId, clientId, row, col, value, style } = command;

  if (typeof docId !== 'string' || !docId.trim() || typeof clientId !== 'string' || !clientId.trim() || !isValidCellPosition(row) || !isValidCellPosition(col)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, row and col are required');
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    row,
    col,
    value: value ?? '',
    style: style !== undefined ? style : null,
  };
}

function trimUndoStack(entries) {
  const limit = Number.isInteger(collabConfig.userOpStackLimit) && collabConfig.userOpStackLimit > 0
    ? collabConfig.userOpStackLimit
    : 100;

  if (entries.length <= limit) {
    return entries;
  }

  return entries.slice(entries.length - limit);
}

async function applySetCell(command = {}) {
  const normalizedCommand = normalizeSetCellCommand(command);
  const updatedDoc = await docsService.applySetCell({
    docId: normalizedCommand.docId,
    row: normalizedCommand.row,
    col: normalizedCommand.col,
    value: normalizedCommand.value,
    style: normalizedCommand.style,
  });

  if (!updatedDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const seq = updatedDoc.currentSeq;
  const { value: oldValue, style: oldStyle } = updatedDoc._before;

  await historyStore.append({
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
    opType: 'set_cell',
    targetRow: normalizedCommand.row,
    targetCol: normalizedCommand.col,
    oldValueJson: { value: oldValue, style: oldStyle },
    newValueJson: { value: normalizedCommand.value, style: normalizedCommand.style },
  });

  const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId);
  const undoStack = opState ? [...opState.undoStackJson] : [];
  undoStack.push({
    sourceSeq: seq,
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    opType: 'set_cell',
    row: normalizedCommand.row,
    col: normalizedCommand.col,
    oldValue,
    oldStyle,
    newValue: normalizedCommand.value,
    newStyle: normalizedCommand.style,
  });
  const trimmedUndoStack = trimUndoStack(undoStack);
  await userOpStateStore.saveState({
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    undoStackJson: trimmedUndoStack,
    redoStackJson: [],
  });

  await auditService.recordAuditEvent({
    type: 'set_cell',
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
  });

  return {
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
    row: normalizedCommand.row,
    col: normalizedCommand.col,
    value: normalizedCommand.value,
    style: normalizedCommand.style,
    canUndo: true,
    canRedo: false,
  };
}

module.exports = {
  applySetCell,
};
