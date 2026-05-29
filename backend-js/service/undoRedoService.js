const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { isNonEmptyString } = require('../protocol/validators');
const {
  resolveUndoRedoOperation,
  createAppliedStackEntry,
  createRedoStackEntry,
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
    let updatedDoc = null;
    let seq = 0;
    let undoStack = [];
    let trimmedRedoStack = [];
    let entry = null;
    let otResult = null;

    const executeMutation = async (connection = null) => {
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
      otResult = await resolveUndoRedoOperation({
        docId: normalizedCommand.docId,
        entry,
        desiredState: {
          value: entry.oldValue,
          style: entry.oldStyle,
        },
        currentDoc,
        historyStore,
        connection,
      });

      updatedDoc = await docsService.applySetCell({
        docId: normalizedCommand.docId,
        row: entry.row,
        col: entry.col,
        value: otResult.targetState.value,
        style: otResult.targetState.style,
      }, {
        connection,
      });

      if (!updatedDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      seq = updatedDoc.currentSeq;

      const undoHistoryEntry = {
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        seq,
        baseSeq: otResult.baseSeq,
        opType: 'undo',
        sourceSeq: entry.sourceSeq,
        targetRow: entry.row,
        targetCol: entry.col,
        oldValueJson: { value: otResult.currentState.value, style: otResult.currentState.style },
        newValueJson: { value: otResult.targetState.value, style: otResult.targetState.style },
      };

      if (connection) {
        await historyStore.append(undoHistoryEntry, { connection });
      } else {
        await appendHistoryBestEffort(historyStore, undoHistoryEntry, 'undo');
      }

      redoStack.push(createRedoStackEntry({
        sourceSeq: seq,
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        row: entry.row,
        col: entry.col,
        beforeState: otResult.currentState,
        afterState: otResult.targetState,
      }));
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

    if (storeConfig.driver === 'mysql') {
      await withTransaction(async (connection) => executeMutation(connection));
    } else {
      await executeMutation();
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
  const { historyStore } = command;
  const normalizedCommand = normalizeUndoRedoCommand(command);

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let updatedDoc = null;
    let seq = 0;
    let redoStack = [];
    let trimmedUndoStack = [];
    let entry = null;
    let otResult = null;

    const executeMutation = async (connection = null) => {
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
      otResult = await resolveUndoRedoOperation({
        docId: normalizedCommand.docId,
        entry,
        desiredState: {
          value: entry.newValue,
          style: entry.newStyle,
        },
        currentDoc,
        historyStore,
        connection,
      });

      updatedDoc = await docsService.applySetCell({
        docId: normalizedCommand.docId,
        row: entry.row,
        col: entry.col,
        value: otResult.targetState.value,
        style: otResult.targetState.style,
      }, {
        connection,
      });

      if (!updatedDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      seq = updatedDoc.currentSeq;

      const redoHistoryEntry = {
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        seq,
        baseSeq: otResult.baseSeq,
        opType: 'redo',
        sourceSeq: entry.sourceSeq,
        targetRow: entry.row,
        targetCol: entry.col,
        oldValueJson: { value: otResult.currentState.value, style: otResult.currentState.style },
        newValueJson: { value: otResult.targetState.value, style: otResult.targetState.style },
      };

      if (connection) {
        await historyStore.append(redoHistoryEntry, { connection });
      } else {
        await appendHistoryBestEffort(historyStore, redoHistoryEntry, 'redo');
      }

      undoStack.push(createAppliedStackEntry({
        sourceSeq: seq,
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        row: entry.row,
        col: entry.col,
        beforeState: otResult.currentState,
        afterState: otResult.targetState,
      }));
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

    if (storeConfig.driver === 'mysql') {
      await withTransaction(async (connection) => executeMutation(connection));
    } else {
      await executeMutation();
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
