const { ERROR_CODES } = require('../protocol/errorCodes');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const docRealtimeService = require('./docRealtimeService');
const auditService = require('../audit/auditService');
const { validateSheetStructureChange } = require('../utils/sheetStructure');
const roomService = require('./roomService');
const { applySheetStructureChangeToRealtimeDoc } = require('../utils/realtimeDocMutation');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function normalizeStructureCommand(command = {}, opType) {
  const { docId, clientId, sheetId, row, col } = command;
  const requiresRow = opType.endsWith('_row');
  const positionValue = requiresRow ? row : col;

  if (
    typeof docId !== 'string'
    || !docId.trim()
    || typeof clientId !== 'string'
    || !clientId.trim()
    || typeof sheetId !== 'string'
    || !sheetId.trim()
    || !isPositiveInteger(positionValue)
  ) {
    throw createServiceError(
      ERROR_CODES.INVALID_PARAMS,
      requiresRow
        ? 'docId, clientId, sheetId and row are required'
        : 'docId, clientId, sheetId and col are required'
    );
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    sheetId: sheetId.trim(),
    opType,
    row: requiresRow ? row : null,
    col: requiresRow ? null : col,
  };
}

function createOutOfRangeMessage(positionField, opType, upperBound) {
  if (positionField === 'row') {
    return opType === 'insert_row'
      ? `row must be between 1 and ${upperBound}`
      : `row must be between 1 and ${upperBound}`;
  }

  return opType === 'insert_col'
    ? `col must be between 1 and ${upperBound}`
    : `col must be between 1 and ${upperBound}`;
}

async function clearRealtimeUndoRedoByDoc(docId, fallbackClientId = null, updatedAt = new Date().toISOString()) {
  const trackedClientIds = await docRealtimeService.listTrackedUserClientIds(docId);
  const roomUsers = await roomService.getRoomUsers(docId).catch(() => []);
  const clientIds = Array.from(new Set([
    ...trackedClientIds,
    ...roomUsers.map((user) => user.clientId),
    fallbackClientId,
  ].filter(Boolean)));

  await Promise.all(clientIds.map((clientId) => docRealtimeService.saveUserOpState({
    docId,
    clientId,
    undoStackJson: [],
    redoStackJson: [],
    updatedAt,
  })));
}

async function applyStructureChange(command = {}, opType) {
  const normalizedCommand = normalizeStructureCommand(command, opType);

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let currentDoc = null;
    let seq = 0;
    let updatedAt = null;
    currentDoc = await docRealtimeService.getRealtimeDoc(normalizedCommand.docId);

    if (!currentDoc) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    const validation = validateSheetStructureChange(currentDoc.snapshotJson, normalizedCommand);

    if (!validation.ok) {
      if (validation.reason === 'sheet_not_found') {
        throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${normalizedCommand.sheetId}`, {
          docId: normalizedCommand.docId,
          sheetId: normalizedCommand.sheetId,
        });
      }

      throw createServiceError(
        ERROR_CODES.INVALID_PARAMS,
        createOutOfRangeMessage(validation.positionField, normalizedCommand.opType, validation.upperBound),
        {
          docId: normalizedCommand.docId,
          sheetId: normalizedCommand.sheetId,
          [validation.positionField]: validation.positionValue,
          upperBound: validation.upperBound,
        }
      );
    }

    const structureResult = applySheetStructureChangeToRealtimeDoc(currentDoc, normalizedCommand);
    if (!structureResult.ok || !structureResult.targetSheetId) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    seq = await docRealtimeService.allocateNextSeq(normalizedCommand.docId);
    updatedAt = new Date().toISOString();

    await docRealtimeService.saveRealtimeDoc(normalizedCommand.docId, {
      title: currentDoc.title,
      snapshotJson: structureResult.nextSnapshot,
      currentSeq: seq,
      updatedAt,
    });

    await docRealtimeService.appendOp(normalizedCommand.docId, {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      opType: normalizedCommand.opType,
      targetSheetId: structureResult.targetSheetId || normalizedCommand.sheetId,
      targetRow: normalizedCommand.row,
      targetCol: normalizedCommand.col,
      payloadJson: {
        type: normalizedCommand.opType,
        sheetId: structureResult.targetSheetId || normalizedCommand.sheetId,
        row: normalizedCommand.row,
        col: normalizedCommand.col,
        clearUndoRedo: true,
      },
      createdAt: updatedAt,
    });

    await clearRealtimeUndoRedoByDoc(
      normalizedCommand.docId,
      normalizedCommand.clientId,
      updatedAt
    );

    await docsService.invalidateDocCaches(normalizedCommand.docId);

    await auditService.recordAuditEvent({
      type: normalizedCommand.opType,
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      sheetId: structureResult.targetSheetId || normalizedCommand.sheetId,
      row: normalizedCommand.row,
      col: normalizedCommand.col,
      clearedUndoRedo: true,
    });

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: structureResult.targetSheetId || normalizedCommand.sheetId,
      seq,
      ...(normalizedCommand.row !== null ? { row: normalizedCommand.row } : {}),
      ...(normalizedCommand.col !== null ? { col: normalizedCommand.col } : {}),
      canUndo: false,
      canRedo: false,
    };
  });
}

async function applyInsertRow(command = {}) {
  return applyStructureChange(command, 'insert_row');
}

async function applyDeleteRow(command = {}) {
  return applyStructureChange(command, 'delete_row');
}

async function applyInsertCol(command = {}) {
  return applyStructureChange(command, 'insert_col');
}

async function applyDeleteCol(command = {}) {
  return applyStructureChange(command, 'delete_col');
}

module.exports = {
  applyInsertRow,
  applyDeleteRow,
  applyInsertCol,
  applyDeleteCol,
};
