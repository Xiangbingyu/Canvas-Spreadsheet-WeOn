const { ERROR_CODES } = require('../protocol/errorCodes');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const docRealtimeService = require('./docRealtimeService');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { normalizeBaseSeq, rebaseSetCellCommand } = require('./cellOtService');
const { createRealtimeHistoryStore } = require('./realtimeHistoryService');
const { applySetCellToRealtimeDoc } = require('../utils/realtimeDocMutation');

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
  const { docId, clientId, sheetId, row, col, value, style } = command;

  if (
    typeof docId !== 'string'
    || !docId.trim()
    || typeof clientId !== 'string'
    || !clientId.trim()
    || typeof sheetId !== 'string'
    || !sheetId.trim()
    || !isValidCellPosition(row)
    || !isValidCellPosition(col)
  ) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, sheetId, row and col are required');
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    sheetId: sheetId.trim(),
    row,
    col,
    value: value ?? '',
    style: style !== undefined ? style : null,
    baseSeq: normalizeBaseSeq(command.baseSeq),
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
  const realtimeHistoryStore = createRealtimeHistoryStore();

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let currentDoc = null;
    let seq = 0;
    let updatedAt = null;
    let trimmedUndoStack = [];
    let rebaseResult = {
      enabled: false,
      rebased: false,
      baseSeq: null,
      conflictSeq: null,
    };
    currentDoc = await docRealtimeService.getRealtimeDoc(normalizedCommand.docId);

    if (!currentDoc) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    const otResult = await rebaseSetCellCommand({
      command: normalizedCommand,
      currentDoc,
      historyStore: realtimeHistoryStore,
    });

    rebaseResult = otResult.rebaseResult;

    const nextMutation = applySetCellToRealtimeDoc(currentDoc, otResult.command);
    if (!nextMutation) {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${normalizedCommand.sheetId}`, {
        docId: normalizedCommand.docId,
        sheetId: normalizedCommand.sheetId,
      });
    }

    seq = await docRealtimeService.allocateNextSeq(normalizedCommand.docId);
    updatedAt = new Date().toISOString();

    await docRealtimeService.saveRealtimeDoc(normalizedCommand.docId, {
      title: currentDoc.title,
      snapshotJson: nextMutation.nextSnapshot,
      currentSeq: seq,
      updatedAt,
    });

    const opState = await docRealtimeService.getUserOpState(normalizedCommand.docId, normalizedCommand.clientId);
    const undoStack = opState ? [...opState.undoStackJson] : [];
    undoStack.push({
      sourceSeq: seq,
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      opType: 'set_cell',
      sheetId: nextMutation.targetSheetId,
      row: normalizedCommand.row,
      col: normalizedCommand.col,
      oldValue: nextMutation.beforeState.value,
      oldStyle: nextMutation.beforeState.style,
      newValue: normalizedCommand.value,
      newStyle: normalizedCommand.style,
      baseSeq: rebaseResult.baseSeq,
    });
    trimmedUndoStack = trimUndoStack(undoStack);

    await docRealtimeService.saveUserOpState({
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      undoStackJson: trimmedUndoStack,
      redoStackJson: [],
      updatedAt,
    });

    await docRealtimeService.appendOp(normalizedCommand.docId, {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      baseSeq: rebaseResult.baseSeq,
      opType: 'set_cell',
      targetSheetId: nextMutation.targetSheetId,
      targetRow: normalizedCommand.row,
      targetCol: normalizedCommand.col,
      oldValueJson: {
        value: nextMutation.beforeState.value,
        style: nextMutation.beforeState.style,
      },
      newValueJson: {
        value: normalizedCommand.value,
        style: normalizedCommand.style,
      },
      createdAt: updatedAt,
    });

    await docsService.invalidateDocCaches(normalizedCommand.docId);

    await auditService.recordAuditEvent({
      type: 'set_cell',
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
    });

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: nextMutation.targetSheetId || normalizedCommand.sheetId,
      seq,
      row: normalizedCommand.row,
      col: normalizedCommand.col,
      value: normalizedCommand.value,
      style: normalizedCommand.style,
      canUndo: true,
      canRedo: false,
    };
  });
}

module.exports = {
  applySetCell,
};
