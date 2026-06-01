const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const { validateSheetStructureChange } = require('../utils/sheetStructure');

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

async function applyStructureChange(command = {}, opType) {
  const normalizedCommand = normalizeStructureCommand(command, opType);

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let updatedDoc = null;
    let seq = 0;
    let canUndo = false;
    let canRedo = false;

    const executeMutation = async (connection = null) => {
      const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId, {
        connection,
        forUpdate: Boolean(connection),
      });

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

      updatedDoc = await docsService.applySheetStructureChange(normalizedCommand, { connection });

      if (!updatedDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      seq = updatedDoc.currentSeq;

      await historyStore.append({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        seq,
        opType: normalizedCommand.opType,
        targetSheetId: updatedDoc._targetSheetId || normalizedCommand.sheetId,
        targetRow: normalizedCommand.row,
        targetCol: normalizedCommand.col,
        payloadJson: {
          type: normalizedCommand.opType,
          sheetId: updatedDoc._targetSheetId || normalizedCommand.sheetId,
          row: normalizedCommand.row,
          col: normalizedCommand.col,
          clearUndoRedo: false,
        },
      }, { connection });

      const opState = await userOpStateStore.getState(
        normalizedCommand.docId,
        normalizedCommand.clientId,
        { connection }
      );
      canUndo = Boolean(opState && Array.isArray(opState.undoStackJson) && opState.undoStackJson.length > 0);
      canRedo = Boolean(opState && Array.isArray(opState.redoStackJson) && opState.redoStackJson.length > 0);
    };

    if (storeConfig.driver === 'mysql') {
      await withTransaction(async (connection) => executeMutation(connection));
    } else {
      await executeMutation();
    }

    await docsService.invalidateDocCaches(normalizedCommand.docId);

    await auditService.recordAuditEvent({
      type: normalizedCommand.opType,
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      sheetId: updatedDoc && updatedDoc._targetSheetId ? updatedDoc._targetSheetId : normalizedCommand.sheetId,
      row: normalizedCommand.row,
      col: normalizedCommand.col,
      clearedUndoRedo: false,
    });

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: updatedDoc && updatedDoc._targetSheetId ? updatedDoc._targetSheetId : normalizedCommand.sheetId,
      seq,
      ...(normalizedCommand.row !== null ? { row: normalizedCommand.row } : {}),
      ...(normalizedCommand.col !== null ? { col: normalizedCommand.col } : {}),
      canUndo,
      canRedo,
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
