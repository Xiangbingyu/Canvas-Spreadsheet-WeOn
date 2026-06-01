const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { normalizeBaseSeq, rebaseSetCellCommand } = require('./cellOtService');

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

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let updatedDoc = null;
    let seq = 0;
    let trimmedUndoStack = [];
    let effectiveCommand = normalizedCommand;
    let rebaseResult = {
      enabled: false,
      rebased: false,
      baseSeq: null,
      conflictSeq: null,
    };

    const executeMutation = async (connection = null) => {
      const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId, {
        connection,
        forUpdate: Boolean(connection),
      });

      if (!currentDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      const otResult = await rebaseSetCellCommand({
        command: normalizedCommand,
        currentDoc,
        historyStore,
        connection,
      });
      effectiveCommand = otResult.command;

      rebaseResult = otResult.rebaseResult;

      const currentSnapshot = currentDoc.snapshotJson || {};
      const currentSheets = currentSnapshot.sheets || {};

      if (!currentSheets[effectiveCommand.sheetId]) {
        throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${effectiveCommand.sheetId}`, {
          docId: effectiveCommand.docId,
          sheetId: effectiveCommand.sheetId,
        });
      }

      updatedDoc = await docsService.applySetCell({
        ...effectiveCommand,
      }, {
        connection,
      });

      if (!updatedDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      seq = updatedDoc.currentSeq;
      const targetSheetId = updatedDoc._targetSheetId;
      const { value: oldValue, style: oldStyle } = updatedDoc._before;

      await historyStore.append({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        seq,
        baseSeq: rebaseResult.baseSeq,
        opType: 'set_cell',
        targetSheetId,
        targetRow: effectiveCommand.row,
        targetCol: effectiveCommand.col,
        oldValueJson: { value: oldValue, style: oldStyle },
        newValueJson: { value: effectiveCommand.value, style: effectiveCommand.style },
      }, { connection });

      const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId, { connection });
      const undoStack = opState ? [...opState.undoStackJson] : [];
      undoStack.push({
        sourceSeq: seq,
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        opType: 'set_cell',
        sheetId: targetSheetId,
        row: effectiveCommand.row,
        col: effectiveCommand.col,
        oldValue,
        oldStyle,
        newValue: effectiveCommand.value,
        newStyle: effectiveCommand.style,
        baseSeq: rebaseResult.baseSeq,
      });
      trimmedUndoStack = trimUndoStack(undoStack);

      await userOpStateStore.saveState({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: trimmedUndoStack,
        redoStackJson: [],
      }, { connection });
    };

    if (storeConfig.driver === 'mysql') {
      await withTransaction(async (connection) => executeMutation(connection));
    } else {
      await executeMutation();
    }

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
      sheetId: updatedDoc && updatedDoc._targetSheetId ? updatedDoc._targetSheetId : effectiveCommand.sheetId,
      seq,
      row: effectiveCommand.row,
      col: effectiveCommand.col,
      value: effectiveCommand.value,
      style: effectiveCommand.style,
      canUndo: true,
      canRedo: false,
    };
  });
}

module.exports = {
  applySetCell,
};
