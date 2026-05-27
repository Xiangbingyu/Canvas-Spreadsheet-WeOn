const { ERROR_CODES } = require('../protocol/errorCodes');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isValidSnapshot(snapshot) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot);
}

function normalizeImportSheetCommand(command = {}) {
  const { docId, clientId, snapshot, snapshotJson, eventId } = command;
  const normalizedSnapshot = snapshotJson || snapshot;

  if (typeof docId !== 'string' || !docId.trim() || typeof clientId !== 'string' || !clientId.trim() || !isValidSnapshot(normalizedSnapshot)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId and snapshot are required');
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    snapshot: normalizedSnapshot,
    eventId,
  };
}

async function executeImportSheet(normalizedCommand) {
  const updatedDoc = await docsService.applyImportSheet({
    docId: normalizedCommand.docId,
    snapshotJson: normalizedCommand.snapshot,
  });

  if (!updatedDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const seq = updatedDoc.currentSeq;

  await historyStore.append({
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
    opType: 'import_sheet',
    eventId: normalizedCommand.eventId ? String(normalizedCommand.eventId) : null,
    payloadJson: normalizedCommand.snapshot,
  });

  await userOpStateStore.saveState({
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    undoStackJson: [],
    redoStackJson: [],
  });

  await auditService.recordAuditEvent({
    type: 'import_sheet',
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
  });

  return {
    docId: normalizedCommand.docId,
    clientId: normalizedCommand.clientId,
    seq,
    snapshot: updatedDoc.snapshotJson,
    canUndo: false,
    canRedo: false,
  };
}

async function applyImportSheet(command = {}) {
  const normalizedCommand = normalizeImportSheetCommand(command);
  return executeImportSheet(normalizedCommand);
}

module.exports = {
  applyImportSheet,
};
