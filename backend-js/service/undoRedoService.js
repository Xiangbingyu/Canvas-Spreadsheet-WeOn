const { ERROR_CODES } = require('../protocol/errorCodes');
const docsService = require('./docsService');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { isNonEmptyString } = require('../protocol/validators');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeUndoRedoCommand(command = {}) {
  const { docId, clientId } = command;

  if (!isNonEmptyString(docId) || !isNonEmptyString(clientId)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId and clientId are required');
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
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

async function appendHistoryBestEffort(historyStore, entry, label) {
  try {
    await historyStore.append(entry);
  } catch (error) {
    console.error(`${label} history append failed:`, error);
  }
}

async function saveOpStateBestEffort(state, label) {
  try {
    await userOpStateStore.saveState(state);
  } catch (error) {
    console.error(`${label} user-op-state save failed:`, error);
  }
}

async function recordAuditBestEffort(event, label) {
  try {
    await auditService.recordAuditEvent(event);
  } catch (error) {
    console.error(`${label} audit failed:`, error);
  }
}

async function applyUndo(command = {}) {
  const { historyStore } = command;
  const normalizedCommand = normalizeUndoRedoCommand(command);
  const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId);
  const undoStack = opState ? [...opState.undoStackJson] : [];
  const redoStack = opState ? [...opState.redoStackJson] : [];

  if (undoStack.length === 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'nothing to undo');
  }

  const entry = undoStack.pop();
  const updatedDoc = await docsService.applySetCell({
    docId: normalizedCommand.docId,
    row: entry.row,
    col: entry.col,
    value: entry.oldValue,
    style: entry.oldStyle,
  });

  if (!updatedDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const seq = updatedDoc.currentSeq;

  await appendHistoryBestEffort(historyStore, {
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
    opType: 'undo',
    sourceSeq: entry.sourceSeq,
    targetRow: entry.row,
    targetCol: entry.col,
    oldValueJson: { value: entry.newValue, style: entry.newStyle },
    newValueJson: { value: entry.oldValue, style: entry.oldStyle },
  }, 'undo');

  redoStack.push({
    sourceSeq: entry.sourceSeq,
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    opType: 'set_cell',
    row: entry.row,
    col: entry.col,
    oldValue: entry.oldValue,
    oldStyle: entry.oldStyle,
    newValue: entry.newValue,
    newStyle: entry.newStyle,
  });
  const trimmedRedoStack = trimUndoStack(redoStack);
  await saveOpStateBestEffort({
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    undoStackJson: undoStack,
    redoStackJson: trimmedRedoStack,
  }, 'undo');

  await recordAuditBestEffort({
    type: 'undo',
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
  }, 'undo');

  return {
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
    row: entry.row,
    col: entry.col,
    value: entry.oldValue,
    style: entry.oldStyle,
    canUndo: undoStack.length > 0,
    canRedo: true,
  };
}

async function applyRedo(command = {}) {
  const { historyStore } = command;
  const normalizedCommand = normalizeUndoRedoCommand(command);
  const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId);
  const undoStack = opState ? [...opState.undoStackJson] : [];
  const redoStack = opState ? [...opState.redoStackJson] : [];

  if (redoStack.length === 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'nothing to redo');
  }

  const entry = redoStack.pop();
  const updatedDoc = await docsService.applySetCell({
    docId: normalizedCommand.docId,
    row: entry.row,
    col: entry.col,
    value: entry.newValue,
    style: entry.newStyle,
  });

  if (!updatedDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const seq = updatedDoc.currentSeq;

  await appendHistoryBestEffort(historyStore, {
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
    opType: 'redo',
    sourceSeq: entry.sourceSeq,
    targetRow: entry.row,
    targetCol: entry.col,
    oldValueJson: { value: entry.oldValue, style: entry.oldStyle },
    newValueJson: { value: entry.newValue, style: entry.newStyle },
  }, 'redo');

  undoStack.push({
    sourceSeq: entry.sourceSeq,
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    opType: 'set_cell',
    row: entry.row,
    col: entry.col,
    oldValue: entry.oldValue,
    oldStyle: entry.oldStyle,
    newValue: entry.newValue,
    newStyle: entry.newStyle,
  });
  const trimmedUndoStack = trimUndoStack(undoStack);
  await saveOpStateBestEffort({
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    undoStackJson: trimmedUndoStack,
    redoStackJson: redoStack,
  }, 'redo');

  await recordAuditBestEffort({
    type: 'redo',
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
  }, 'redo');

  return {
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
    row: entry.row,
    col: entry.col,
    value: entry.newValue,
    style: entry.newStyle,
    canUndo: true,
    canRedo: redoStack.length > 0,
  };
}

module.exports = {
  applyUndo,
  applyRedo,
};
