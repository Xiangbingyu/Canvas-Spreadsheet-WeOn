const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const realtimeConfig = require('../config/realtimeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { normalizeBaseSeq, rebaseBatchSetCellCommand } = require('./cellOtService');
const { commitBatchSetCell } = require('./gate/gateBatchSetCellService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isValidCellPosition(value) {
  return Number.isInteger(value) && value >= 1;
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

function normalizeBatchUpdate(update = {}) {
  if (!isValidCellPosition(update.row) || !isValidCellPosition(update.col)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'each batch update requires 1-based row and col');
  }

  return {
    row: update.row,
    col: update.col,
  };
}

function createUpdateKey(update) {
  return `${update.row}:${update.col}`;
}

function normalizeBatchSetCellCommand(command = {}) {
  const {
    docId,
    clientId,
    sheetId,
    value,
    style,
    updates,
  } = command;

  if (
    typeof docId !== 'string'
    || !docId.trim()
    || typeof clientId !== 'string'
    || !clientId.trim()
    || typeof sheetId !== 'string'
    || !sheetId.trim()
  ) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId and sheetId are required');
  }

  if (!Array.isArray(updates) || updates.length === 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'updates must be a non-empty array');
  }

  if (value === undefined && style === undefined) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'value or style must be provided');
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    sheetId: sheetId.trim(),
    baseSeq: normalizeBaseSeq(command.baseSeq),
    value,
    style: style !== undefined ? style : undefined,
    updates: updates.map((update) => normalizeBatchUpdate(update)),
  };
}

function dedupeTransformedUpdates(updates, patch) {
  const dedupedByPosition = new Map();

  for (const update of updates) {
    dedupedByPosition.set(createUpdateKey(update), {
      row: update.row,
      col: update.col,
      value: patch.value,
      style: patch.style !== undefined ? patch.style : null,
    });
  }

  return Array.from(dedupedByPosition.values());
}

function toBatchUndoEntry({
  sourceSeq,
  docId,
  clientId,
  sheetId,
  baseSeq,
  patch,
  updates,
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

async function applyBatchSetCell(command = {}) {
  const normalizedCommand = normalizeBatchSetCellCommand(command);

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let seq = 0;
    let trimmedUndoStack = [];
    let effectiveCommand = normalizedCommand;
    let rebaseResult = { enabled: false, rebased: false, baseSeq: null, conflictSeq: null };
    let finalUpdates = [];
    let targetSheetId = normalizedCommand.sheetId;

    if (realtimeConfig.driver === 'redis') {
      const result = await commitBatchSetCell(normalizedCommand);
      seq = result.seq;
      targetSheetId = result.targetSheetId;
      effectiveCommand = result.effectiveCommand;
      rebaseResult = result.rebaseResult;
      finalUpdates = result.batchUpdates.map((update) => ({
        row: update.row,
        col: update.col,
        value: update.newValue,
        style: update.newStyle,
        oldValue: update.oldValue,
        oldStyle: update.oldStyle,
      }));

      const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId);
      const undoStack = opState ? [...opState.undoStackJson] : [];
      undoStack.push(toBatchUndoEntry({
        sourceSeq: seq, docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
        sheetId: targetSheetId, baseSeq: rebaseResult.baseSeq,
        patch: {
          ...(effectiveCommand.value !== undefined ? { value: effectiveCommand.value } : {}),
          ...(effectiveCommand.style !== undefined ? { style: effectiveCommand.style } : {}),
        },
        updates: result.batchUpdates,
      }));
      trimmedUndoStack = trimUndoStack(undoStack);
      await userOpStateStore.saveState({
        docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
        undoStackJson: trimmedUndoStack, redoStackJson: [],
      });
    } else {
      let updatedDoc = null;

      const executeMutation = async (connection = null) => {
        const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId, {
          connection, forUpdate: Boolean(connection),
        });

        if (!currentDoc) {
          throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        }

        const otResult = await rebaseBatchSetCellCommand({
          command: normalizedCommand, currentDoc, historyStore, connection,
        });
        effectiveCommand = otResult.command;
        rebaseResult = otResult.rebaseResult;

        const currentSnapshot = currentDoc.snapshotJson || {};
        const currentSheets = currentSnapshot.sheets || {};

        if (!currentSheets[effectiveCommand.sheetId]) {
          throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${effectiveCommand.sheetId}`, {
            docId: effectiveCommand.docId, sheetId: effectiveCommand.sheetId,
          });
        }

        finalUpdates = dedupeTransformedUpdates(effectiveCommand.updates, {
          value: effectiveCommand.value, style: effectiveCommand.style,
        });

        updatedDoc = await docsService.applyBatchSetCell({
          docId: effectiveCommand.docId, sheetId: effectiveCommand.sheetId, updates: finalUpdates,
        }, { connection });

        if (!updatedDoc) {
          throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        }

        seq = updatedDoc.currentSeq;
        targetSheetId = updatedDoc._targetSheetId || effectiveCommand.sheetId;

        const historyUpdates = (updatedDoc._batchUpdates || []).map((update) => ({
          row: update.row, col: update.col, oldValue: update.oldValue, oldStyle: update.oldStyle,
          newValue: update.newValue, newStyle: update.newStyle,
        }));
        finalUpdates = historyUpdates.map((update) => ({
          row: update.row,
          col: update.col,
          value: update.newValue,
          style: update.newStyle,
          oldValue: update.oldValue,
          oldStyle: update.oldStyle,
        }));

        await historyStore.append({
          docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
          seq, baseSeq: rebaseResult.baseSeq, opType: 'batch_set_cell', targetSheetId,
          payloadJson: {
            type: 'batch_set_cell', sheetId: targetSheetId,
            patch: {
              ...(effectiveCommand.value !== undefined ? { value: effectiveCommand.value } : {}),
              ...(effectiveCommand.style !== undefined ? { style: effectiveCommand.style } : {}),
            },
            updates: historyUpdates,
          },
        }, { connection });

        const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId, { connection });
        const undoStack = opState ? [...opState.undoStackJson] : [];
        undoStack.push(toBatchUndoEntry({
          sourceSeq: seq, docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
          sheetId: targetSheetId, baseSeq: rebaseResult.baseSeq,
          patch: {
            ...(effectiveCommand.value !== undefined ? { value: effectiveCommand.value } : {}),
            ...(effectiveCommand.style !== undefined ? { style: effectiveCommand.style } : {}),
          },
          updates: historyUpdates,
        }));
        trimmedUndoStack = trimUndoStack(undoStack);
        await userOpStateStore.saveState({
          docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
          undoStackJson: trimmedUndoStack, redoStackJson: [],
        }, { connection });
      };

      if (storeConfig.driver === 'mysql') {
        await withTransaction(async (connection) => executeMutation(connection));
      } else {
        await executeMutation();
      }
    }

    await docsService.invalidateDocCaches(normalizedCommand.docId);
    await auditService.recordAuditEvent({
      type: 'batch_set_cell', docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
      seq, sheetId: targetSheetId, updates: finalUpdates,
    });

    return {
      docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
      sheetId: targetSheetId, seq, updates: finalUpdates, canUndo: true, canRedo: false,
    };
  });
}

module.exports = {
  applyBatchSetCell,
};
