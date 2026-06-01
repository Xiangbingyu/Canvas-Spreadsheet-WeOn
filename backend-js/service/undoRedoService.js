const { ERROR_CODES } = require('../protocol/errorCodes');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const docRealtimeService = require('./docRealtimeService');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { isNonEmptyString } = require('../protocol/validators');
const {
  resolveUndoRedoOperation,
  createAppliedStackEntry,
  createRedoStackEntry,
} = require('./undoRedoOtService');
const { createRealtimeHistoryStore } = require('./realtimeHistoryService');
const { applySetCellToRealtimeDoc } = require('../utils/realtimeDocMutation');

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

async function recordAuditBestEffort(event, label) {
  try {
    await auditService.recordAuditEvent(event);
  } catch (error) {
    console.error(`${label} audit failed:`, error);
  }
}

async function applyUndo(command = {}) {
  const normalizedCommand = normalizeUndoRedoCommand(command);
  const realtimeHistoryStore = createRealtimeHistoryStore();

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let currentDoc = null;
    let seq = 0;
    let undoStack = [];
    let trimmedRedoStack = [];
    let entry = null;
    let otResult = null;
    let updatedAt = null;
    currentDoc = await docRealtimeService.getRealtimeDoc(normalizedCommand.docId);

    if (!currentDoc) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    const opState = await docRealtimeService.getUserOpState(normalizedCommand.docId, normalizedCommand.clientId);
    undoStack = opState ? [...opState.undoStackJson] : [];
    const redoStack = opState ? [...opState.redoStackJson] : [];

    if (undoStack.length === 0) {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'nothing to undo');
    }

    entry = undoStack.pop();
    otResult = await resolveUndoRedoOperation({
      docId: normalizedCommand.docId,
      entry,
      desiredState: {
        value: entry.oldValue,
        style: entry.oldStyle,
      },
      currentDoc,
      historyStore: realtimeHistoryStore,
    });

    const nextMutation = applySetCellToRealtimeDoc(currentDoc, {
      docId: normalizedCommand.docId,
      sheetId: entry.sheetId,
      row: entry.row,
      col: entry.col,
      value: otResult.targetState.value,
      style: otResult.targetState.style,
    });

    if (!nextMutation) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    seq = await docRealtimeService.allocateNextSeq(normalizedCommand.docId);
    updatedAt = new Date().toISOString();

    await docRealtimeService.saveRealtimeDoc(normalizedCommand.docId, {
      title: currentDoc.title,
      snapshotJson: nextMutation.nextSnapshot,
      currentSeq: seq,
      updatedAt,
    });

    redoStack.push(createRedoStackEntry({
      sourceSeq: seq,
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: nextMutation.targetSheetId || entry.sheetId || null,
      row: entry.row,
      col: entry.col,
      beforeState: otResult.currentState,
      afterState: otResult.targetState,
    }));
    trimmedRedoStack = trimUndoStack(redoStack);

    await docRealtimeService.saveUserOpState({
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      undoStackJson: undoStack,
      redoStackJson: trimmedRedoStack,
      updatedAt,
    });

    await docRealtimeService.appendOp(normalizedCommand.docId, {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      baseSeq: otResult.baseSeq,
      opType: 'undo',
      sourceSeq: entry.sourceSeq,
      targetSheetId: nextMutation.targetSheetId || entry.sheetId || null,
      targetRow: entry.row,
      targetCol: entry.col,
      oldValueJson: { value: otResult.currentState.value, style: otResult.currentState.style },
      newValueJson: { value: otResult.targetState.value, style: otResult.targetState.style },
      createdAt: updatedAt,
    });

    await docsService.invalidateDocCaches(normalizedCommand.docId);

    await recordAuditBestEffort({
      type: 'undo',
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
    }, 'undo');

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: nextMutation.targetSheetId || (entry.sheetId || null),
      seq,
      row: entry.row,
      col: entry.col,
      value: otResult.targetState.value,
      style: otResult.targetState.style,
      canUndo: undoStack.length > 0,
      canRedo: true,
    };
  });
}

async function applyRedo(command = {}) {
  const normalizedCommand = normalizeUndoRedoCommand(command);
  const realtimeHistoryStore = createRealtimeHistoryStore();

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let currentDoc = null;
    let seq = 0;
    let redoStack = [];
    let trimmedUndoStack = [];
    let entry = null;
    let otResult = null;
    let updatedAt = null;
    currentDoc = await docRealtimeService.getRealtimeDoc(normalizedCommand.docId);

    if (!currentDoc) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    const opState = await docRealtimeService.getUserOpState(normalizedCommand.docId, normalizedCommand.clientId);
    const undoStack = opState ? [...opState.undoStackJson] : [];
    redoStack = opState ? [...opState.redoStackJson] : [];

    if (redoStack.length === 0) {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'nothing to redo');
    }

    entry = redoStack.pop();
    otResult = await resolveUndoRedoOperation({
      docId: normalizedCommand.docId,
      entry,
      desiredState: {
        value: entry.newValue,
        style: entry.newStyle,
      },
      currentDoc,
      historyStore: realtimeHistoryStore,
    });

    const nextMutation = applySetCellToRealtimeDoc(currentDoc, {
      docId: normalizedCommand.docId,
      sheetId: entry.sheetId,
      row: entry.row,
      col: entry.col,
      value: otResult.targetState.value,
      style: otResult.targetState.style,
    });

    if (!nextMutation) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    seq = await docRealtimeService.allocateNextSeq(normalizedCommand.docId);
    updatedAt = new Date().toISOString();

    await docRealtimeService.saveRealtimeDoc(normalizedCommand.docId, {
      title: currentDoc.title,
      snapshotJson: nextMutation.nextSnapshot,
      currentSeq: seq,
      updatedAt,
    });

    undoStack.push(createAppliedStackEntry({
      sourceSeq: seq,
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: nextMutation.targetSheetId || entry.sheetId || null,
      row: entry.row,
      col: entry.col,
      beforeState: otResult.currentState,
      afterState: otResult.targetState,
    }));
    trimmedUndoStack = trimUndoStack(undoStack);

    await docRealtimeService.saveUserOpState({
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      undoStackJson: trimmedUndoStack,
      redoStackJson: redoStack,
      updatedAt,
    });

    await docRealtimeService.appendOp(normalizedCommand.docId, {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      baseSeq: otResult.baseSeq,
      opType: 'redo',
      sourceSeq: entry.sourceSeq,
      targetSheetId: nextMutation.targetSheetId || entry.sheetId || null,
      targetRow: entry.row,
      targetCol: entry.col,
      oldValueJson: { value: otResult.currentState.value, style: otResult.currentState.style },
      newValueJson: { value: otResult.targetState.value, style: otResult.targetState.style },
      createdAt: updatedAt,
    });

    await docsService.invalidateDocCaches(normalizedCommand.docId);

    await recordAuditBestEffort({
      type: 'redo',
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
    }, 'redo');

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: nextMutation.targetSheetId || (entry.sheetId || null),
      seq,
      row: entry.row,
      col: entry.col,
      value: otResult.targetState.value,
      style: otResult.targetState.style,
      canUndo: true,
      canRedo: redoStack.length > 0,
    };
  });
}

module.exports = {
  applyUndo,
  applyRedo,
};
