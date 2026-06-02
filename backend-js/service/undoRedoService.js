const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const realtimeConfig = require('../config/realtimeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const { normalizeDocSnapshot } = require('../domain/entities/doc');
const userOpStateStore = require('../store/userOpStateStore');
const docRealtimeStore = require('../store/redis/docRealtimeStore');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { isNonEmptyString } = require('../protocol/validators');
const {
  resolveUndoRedoOperation,
  resolveUndoRedoBatchOperation,
  createAppliedStackEntry,
  createRedoStackEntry,
  createAppliedBatchStackEntry,
  createRedoBatchStackEntry,
} = require('./undoRedoOtService');

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

function isBatchEntry(entry) {
  return entry && entry.opType === 'batch_set_cell' && Array.isArray(entry.updates);
}

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

function findOrCreateStyleId(sheet, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return null;
  }

  const styleKey = stableStringify(style);
  for (const [styleId, styleValue] of Object.entries(sheet.styles || {})) {
    if (stableStringify(styleValue) === styleKey) {
      return styleId;
    }
  }

  const existingIds = Object.keys(sheet.styles || {});
  let maxStyleNumber = 0;
  for (const id of existingIds) {
    const match = /^style_(\d+)$/.exec(id);
    if (match) {
      maxStyleNumber = Math.max(maxStyleNumber, Number(match[1]));
    }
  }

  const styleId = `style_${String(maxStyleNumber + 1).padStart(3, '0')}`;
  sheet.styles = sheet.styles || {};
  sheet.styles[styleId] = JSON.parse(JSON.stringify(style));
  return styleId;
}

function getRealtimeTargetSheet(snapshot, preferredSheetId) {
  const sheetId = preferredSheetId && snapshot.sheets && snapshot.sheets[preferredSheetId]
    ? preferredSheetId
    : snapshot.activeSheetId;
  const sheet = sheetId && snapshot.sheets ? snapshot.sheets[sheetId] : null;

  if (!sheetId || !sheet) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${preferredSheetId || sheetId}`, {
      sheetId: preferredSheetId || sheetId || null,
    });
  }

  return { sheetId, sheet };
}

async function commitRealtimeSingleCellMutation({
  actionType,
  normalizedCommand,
  entry,
  currentDoc,
  otResult,
}) {
  const nextSnapshot = JSON.parse(JSON.stringify(
    normalizeDocSnapshot(currentDoc.snapshotJson, { docId: normalizedCommand.docId })
  ));
  const { sheetId: targetSheetId, sheet: targetSheet } = getRealtimeTargetSheet(nextSnapshot, otResult.sheetId || entry.sheetId);
  const cellKey = `${otResult.row}:${otResult.col}`;
  const styleId = findOrCreateStyleId(targetSheet, otResult.targetState.style);

  targetSheet.cells = targetSheet.cells || {};
  targetSheet.cells[cellKey] = {
    row: otResult.row,
    col: otResult.col,
    value: otResult.targetState.value ?? '',
    styleId,
  };

  if (otResult.row > targetSheet.rowCount) targetSheet.rowCount = otResult.row;
  if (otResult.col > targetSheet.colCount) targetSheet.colCount = otResult.col;

  const event = {
    opType: actionType,
    clientId: normalizedCommand.clientId,
    sourceSeq: entry.sourceSeq,
    baseSeq: otResult.baseSeq,
    targetSheetId,
    targetRow: otResult.row,
    targetCol: otResult.col,
    oldValueJson: { value: otResult.currentState.value, style: otResult.currentState.style },
    newValueJson: { value: otResult.targetState.value, style: otResult.targetState.style },
  };

  const commitResult = await docsService.commitRealtimeOp(normalizedCommand.docId, {
    expectedBaseSeq: otResult.baseSeq,
    snapshotJson: nextSnapshot,
    event,
  });

  if (!commitResult.ok) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'concurrent modification, please retry', {
      docId: normalizedCommand.docId,
      currentSeq: commitResult.currentSeq,
    });
  }

  return { seq: commitResult.seq, targetSheetId };
}

async function commitRealtimeBatchMutation({
  actionType,
  normalizedCommand,
  entry,
  currentDoc,
  otResult,
}) {
  const nextSnapshot = JSON.parse(JSON.stringify(
    normalizeDocSnapshot(currentDoc.snapshotJson, { docId: normalizedCommand.docId })
  ));
  const { sheetId: targetSheetId, sheet: targetSheet } = getRealtimeTargetSheet(nextSnapshot, otResult.sheetId || entry.sheetId);

  targetSheet.cells = targetSheet.cells || {};
  const appliedUpdates = [];

  for (const update of otResult.updates) {
    const cellKey = `${update.row}:${update.col}`;
    const previousCell = targetSheet.cells[cellKey] || {};
    const previousStyleId = typeof previousCell.styleId === 'string' ? previousCell.styleId : null;
    const oldStyle = previousStyleId && targetSheet.styles ? (targetSheet.styles[previousStyleId] || null) : null;
    const styleId = findOrCreateStyleId(targetSheet, update.style);

    targetSheet.cells[cellKey] = {
      row: update.row,
      col: update.col,
      value: update.value ?? '',
      styleId,
    };

    if (update.row > targetSheet.rowCount) targetSheet.rowCount = update.row;
    if (update.col > targetSheet.colCount) targetSheet.colCount = update.col;

    appliedUpdates.push({
      row: update.row,
      col: update.col,
      oldValue: hasOwnProperty(update, 'oldValue') ? update.oldValue : (previousCell.value ?? ''),
      oldStyle: hasOwnProperty(update, 'oldStyle') ? update.oldStyle : oldStyle,
      newValue: update.value ?? '',
      newStyle: update.style ?? null,
    });
  }

  const event = {
    opType: actionType,
    clientId: normalizedCommand.clientId,
    sourceSeq: entry.sourceSeq,
    baseSeq: otResult.baseSeq,
    targetSheetId,
    payloadJson: {
      type: 'batch_set_cell',
      sheetId: targetSheetId,
      updates: appliedUpdates,
    },
  };

  const commitResult = await docsService.commitRealtimeOp(normalizedCommand.docId, {
    expectedBaseSeq: otResult.baseSeq,
    snapshotJson: nextSnapshot,
    event,
  });

  if (!commitResult.ok) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'concurrent modification, please retry', {
      docId: normalizedCommand.docId,
      currentSeq: commitResult.currentSeq,
    });
  }

  return { seq: commitResult.seq, targetSheetId, appliedUpdates };
}

function hasOwnProperty(target, key) {
  return Object.prototype.hasOwnProperty.call(target || {}, key);
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

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let seq = 0;
    let undoStack = [];
    let trimmedRedoStack = [];
    let entry = null;
    let otResult = null;
    let targetSheetId = null;
    let responseUpdates = [];

    const executeLegacyMutation = async (connection = null) => {
      let updatedDoc = null;
      const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId, {
        connection,
        forUpdate: Boolean(connection),
      });

      if (!currentDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId, { connection });
      undoStack = opState ? [...opState.undoStackJson] : [];
      const redoStack = opState ? [...opState.redoStackJson] : [];

      if (undoStack.length === 0) {
        throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'nothing to undo');
      }

      entry = undoStack.pop();
      if (isBatchEntry(entry)) {
        otResult = await resolveUndoRedoBatchOperation({
          docId: normalizedCommand.docId,
          entry,
          currentDoc,
          historyStore,
          historySource: null,
          connection,
          direction: 'undo',
        });

        updatedDoc = await docsService.applyBatchSetCell({
          docId: normalizedCommand.docId,
          sheetId: otResult.sheetId,
          updates: otResult.updates,
        }, {
          connection,
        });
        targetSheetId = updatedDoc._targetSheetId || otResult.sheetId || entry.sheetId || null;
        responseUpdates = (updatedDoc._batchUpdates || []).map((update) => ({
          row: update.row,
          col: update.col,
          value: update.newValue,
          style: update.newStyle,
        }));
      } else {
        otResult = await resolveUndoRedoOperation({
          docId: normalizedCommand.docId,
          entry,
          desiredState: {
            value: entry.oldValue,
            style: entry.oldStyle,
          },
          currentDoc,
          historyStore,
          historySource: null,
          connection,
        });

        updatedDoc = await docsService.applySetCell({
          docId: normalizedCommand.docId,
          sheetId: otResult.sheetId,
          row: otResult.row,
          col: otResult.col,
          value: otResult.targetState.value,
          style: otResult.targetState.style,
        }, {
          connection,
        });
        targetSheetId = updatedDoc._targetSheetId || otResult.sheetId || entry.sheetId || null;
      }

      if (!updatedDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      seq = updatedDoc.currentSeq;

      const undoHistoryEntry = isBatchEntry(entry)
        ? {
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          seq,
          baseSeq: otResult.baseSeq,
          opType: 'undo',
          sourceSeq: entry.sourceSeq,
          targetSheetId,
          payloadJson: {
            type: 'batch_set_cell',
            sheetId: targetSheetId,
            updates: updatedDoc._batchUpdates || [],
          },
        }
        : {
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          seq,
          baseSeq: otResult.baseSeq,
          opType: 'undo',
          sourceSeq: entry.sourceSeq,
          targetSheetId,
          targetRow: otResult.row,
          targetCol: otResult.col,
          oldValueJson: { value: otResult.currentState.value, style: otResult.currentState.style },
          newValueJson: { value: otResult.targetState.value, style: otResult.targetState.style },
        };

      if (connection) {
        await historyStore.append(undoHistoryEntry, { connection });
      } else {
        await appendHistoryBestEffort(historyStore, undoHistoryEntry, 'undo');
      }

      if (isBatchEntry(entry)) {
        redoStack.push(createRedoBatchStackEntry({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          sheetId: targetSheetId,
          baseSeq: otResult.baseSeq,
          patch: entry.patch || {},
          updates: updatedDoc._batchUpdates || [],
        }));
      } else {
        redoStack.push(createRedoStackEntry({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          sheetId: targetSheetId,
          row: otResult.row,
          col: otResult.col,
          beforeState: otResult.currentState,
          afterState: otResult.targetState,
        }));
      }
      trimmedRedoStack = trimUndoStack(redoStack);

      const nextOpState = {
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: undoStack,
        redoStackJson: trimmedRedoStack,
      };

      if (connection) {
        await userOpStateStore.saveState(nextOpState, { connection });
      } else {
        await saveOpStateBestEffort(nextOpState, 'undo');
      }
    };

    const executeRealtimeMutation = async () => {
      const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
      if (!currentDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId);
      undoStack = opState ? [...opState.undoStackJson] : [];
      const redoStack = opState ? [...opState.redoStackJson] : [];

      if (undoStack.length === 0) {
        throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'nothing to undo');
      }

      entry = undoStack.pop();
      if (isBatchEntry(entry)) {
        otResult = await resolveUndoRedoBatchOperation({
          docId: normalizedCommand.docId,
          entry,
          currentDoc,
          historyStore,
          historySource: docRealtimeStore,
          direction: 'undo',
        });

        const commitResult = await commitRealtimeBatchMutation({
          actionType: 'undo',
          normalizedCommand,
          entry,
          currentDoc,
          otResult,
        });

        seq = commitResult.seq;
        targetSheetId = commitResult.targetSheetId;
        responseUpdates = commitResult.appliedUpdates.map((update) => ({
          row: update.row,
          col: update.col,
          value: update.newValue,
          style: update.newStyle,
        }));

        redoStack.push(createRedoBatchStackEntry({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          sheetId: targetSheetId,
          baseSeq: otResult.baseSeq,
          patch: entry.patch || {},
          updates: commitResult.appliedUpdates,
        }));
      } else {
        otResult = await resolveUndoRedoOperation({
          docId: normalizedCommand.docId,
          entry,
          desiredState: {
            value: entry.oldValue,
            style: entry.oldStyle,
          },
          currentDoc,
          historyStore,
          historySource: docRealtimeStore,
        });

        const commitResult = await commitRealtimeSingleCellMutation({
          actionType: 'undo',
          normalizedCommand,
          entry,
          currentDoc,
          otResult,
        });

        seq = commitResult.seq;
        targetSheetId = commitResult.targetSheetId;
        redoStack.push(createRedoStackEntry({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          sheetId: targetSheetId,
          row: otResult.row,
          col: otResult.col,
          beforeState: otResult.currentState,
          afterState: otResult.targetState,
        }));
      }

      trimmedRedoStack = trimUndoStack(redoStack);
      await userOpStateStore.saveState({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: undoStack,
        redoStackJson: trimmedRedoStack,
      });
    };

    if (realtimeConfig.driver === 'redis') {
      await executeRealtimeMutation();
    } else if (storeConfig.driver === 'mysql') {
      await withTransaction(async (connection) => executeLegacyMutation(connection));
    } else {
      await executeLegacyMutation();
    }

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
      sheetId: targetSheetId || otResult.sheetId || entry.sheetId || null,
      seq,
      ...(isBatchEntry(entry)
        ? { updates: responseUpdates }
        : {
          row: otResult.row,
          col: otResult.col,
          value: otResult.targetState.value,
          style: otResult.targetState.style,
        }),
      canUndo: undoStack.length > 0,
      canRedo: true,
    };
  });
}

async function applyRedo(command = {}) {
  const { historyStore } = command;
  const normalizedCommand = normalizeUndoRedoCommand(command);

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let seq = 0;
    let redoStack = [];
    let trimmedUndoStack = [];
    let entry = null;
    let otResult = null;
    let targetSheetId = null;
    let responseUpdates = [];

    const executeLegacyMutation = async (connection = null) => {
      let updatedDoc = null;
      const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId, {
        connection,
        forUpdate: Boolean(connection),
      });

      if (!currentDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId, { connection });
      const undoStack = opState ? [...opState.undoStackJson] : [];
      redoStack = opState ? [...opState.redoStackJson] : [];

      if (redoStack.length === 0) {
        throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'nothing to redo');
      }

      entry = redoStack.pop();
      if (isBatchEntry(entry)) {
        otResult = await resolveUndoRedoBatchOperation({
          docId: normalizedCommand.docId,
          entry,
          currentDoc,
          historyStore,
          historySource: null,
          connection,
          direction: 'redo',
        });

        updatedDoc = await docsService.applyBatchSetCell({
          docId: normalizedCommand.docId,
          sheetId: otResult.sheetId,
          updates: otResult.updates,
        }, {
          connection,
        });
        targetSheetId = updatedDoc._targetSheetId || otResult.sheetId || entry.sheetId || null;
        responseUpdates = (updatedDoc._batchUpdates || []).map((update) => ({
          row: update.row,
          col: update.col,
          value: update.newValue,
          style: update.newStyle,
        }));
      } else {
        otResult = await resolveUndoRedoOperation({
          docId: normalizedCommand.docId,
          entry,
          desiredState: {
            value: entry.newValue,
            style: entry.newStyle,
          },
          currentDoc,
          historyStore,
          historySource: null,
          connection,
        });

        updatedDoc = await docsService.applySetCell({
          docId: normalizedCommand.docId,
          sheetId: otResult.sheetId,
          row: otResult.row,
          col: otResult.col,
          value: otResult.targetState.value,
          style: otResult.targetState.style,
        }, {
          connection,
        });
        targetSheetId = updatedDoc._targetSheetId || otResult.sheetId || entry.sheetId || null;
      }

      if (!updatedDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      seq = updatedDoc.currentSeq;

      const redoHistoryEntry = isBatchEntry(entry)
        ? {
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          seq,
          baseSeq: otResult.baseSeq,
          opType: 'redo',
          sourceSeq: entry.sourceSeq,
          targetSheetId,
          payloadJson: {
            type: 'batch_set_cell',
            sheetId: targetSheetId,
            updates: updatedDoc._batchUpdates || [],
          },
        }
        : {
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          seq,
          baseSeq: otResult.baseSeq,
          opType: 'redo',
          sourceSeq: entry.sourceSeq,
          targetSheetId,
          targetRow: otResult.row,
          targetCol: otResult.col,
          oldValueJson: { value: otResult.currentState.value, style: otResult.currentState.style },
          newValueJson: { value: otResult.targetState.value, style: otResult.targetState.style },
        };

      if (connection) {
        await historyStore.append(redoHistoryEntry, { connection });
      } else {
        await appendHistoryBestEffort(historyStore, redoHistoryEntry, 'redo');
      }

      if (isBatchEntry(entry)) {
        undoStack.push(createAppliedBatchStackEntry({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          sheetId: targetSheetId,
          baseSeq: otResult.baseSeq,
          patch: entry.patch || {},
          updates: updatedDoc._batchUpdates || [],
        }));
      } else {
        undoStack.push(createAppliedStackEntry({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          sheetId: targetSheetId,
          row: otResult.row,
          col: otResult.col,
          beforeState: otResult.currentState,
          afterState: otResult.targetState,
        }));
      }
      trimmedUndoStack = trimUndoStack(undoStack);

      const nextOpState = {
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: trimmedUndoStack,
        redoStackJson: redoStack,
      };

      if (connection) {
        await userOpStateStore.saveState(nextOpState, { connection });
      } else {
        await saveOpStateBestEffort(nextOpState, 'redo');
      }
    };

    const executeRealtimeMutation = async () => {
      const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
      if (!currentDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId);
      const undoStack = opState ? [...opState.undoStackJson] : [];
      redoStack = opState ? [...opState.redoStackJson] : [];

      if (redoStack.length === 0) {
        throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'nothing to redo');
      }

      entry = redoStack.pop();
      if (isBatchEntry(entry)) {
        otResult = await resolveUndoRedoBatchOperation({
          docId: normalizedCommand.docId,
          entry,
          currentDoc,
          historyStore,
          historySource: docRealtimeStore,
          direction: 'redo',
        });

        const commitResult = await commitRealtimeBatchMutation({
          actionType: 'redo',
          normalizedCommand,
          entry,
          currentDoc,
          otResult,
        });

        seq = commitResult.seq;
        targetSheetId = commitResult.targetSheetId;
        responseUpdates = commitResult.appliedUpdates.map((update) => ({
          row: update.row,
          col: update.col,
          value: update.newValue,
          style: update.newStyle,
        }));

        undoStack.push(createAppliedBatchStackEntry({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          sheetId: targetSheetId,
          baseSeq: otResult.baseSeq,
          patch: entry.patch || {},
          updates: commitResult.appliedUpdates,
        }));
      } else {
        otResult = await resolveUndoRedoOperation({
          docId: normalizedCommand.docId,
          entry,
          desiredState: {
            value: entry.newValue,
            style: entry.newStyle,
          },
          currentDoc,
          historyStore,
          historySource: docRealtimeStore,
        });

        const commitResult = await commitRealtimeSingleCellMutation({
          actionType: 'redo',
          normalizedCommand,
          entry,
          currentDoc,
          otResult,
        });

        seq = commitResult.seq;
        targetSheetId = commitResult.targetSheetId;
        undoStack.push(createAppliedStackEntry({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          sheetId: targetSheetId,
          row: otResult.row,
          col: otResult.col,
          beforeState: otResult.currentState,
          afterState: otResult.targetState,
        }));
      }

      trimmedUndoStack = trimUndoStack(undoStack);
      await userOpStateStore.saveState({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: trimmedUndoStack,
        redoStackJson: redoStack,
      });
    };

    if (realtimeConfig.driver === 'redis') {
      await executeRealtimeMutation();
    } else if (storeConfig.driver === 'mysql') {
      await withTransaction(async (connection) => executeLegacyMutation(connection));
    } else {
      await executeLegacyMutation();
    }

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
      sheetId: targetSheetId || otResult.sheetId || entry.sheetId || null,
      seq,
      ...(isBatchEntry(entry)
        ? { updates: responseUpdates }
        : {
          row: otResult.row,
          col: otResult.col,
          value: otResult.targetState.value,
          style: otResult.targetState.style,
        }),
      canUndo: true,
      canRedo: redoStack.length > 0,
    };
  });
}

module.exports = {
  applyUndo,
  applyRedo,
};
