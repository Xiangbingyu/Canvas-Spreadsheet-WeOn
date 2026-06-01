const { ERROR_CODES } = require('../protocol/errorCodes');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const docRealtimeService = require('./docRealtimeService');
const auditService = require('../audit/auditService');
const { normalizeDocSnapshot } = require('../domain/entities/doc');
const { applyImportSheetToRealtimeDoc } = require('../utils/realtimeDocMutation');

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
  const rawSnapshot = snapshotJson || snapshot;

  if (typeof docId !== 'string' || !docId.trim() || typeof clientId !== 'string' || !clientId.trim() || !isValidSnapshot(rawSnapshot)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId and snapshot are required');
  }

  const normalizedDocId = docId.trim();

  return {
    docId: normalizedDocId,
    clientId: clientId.trim(),
    snapshot: normalizeDocSnapshot(rawSnapshot, { docId: normalizedDocId }),
    eventId,
  };
}

async function executeImportSheet(normalizedCommand) {
  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let currentDoc = null;
    let seq = 0;
    let updatedAt = null;
    currentDoc = await docRealtimeService.getRealtimeDoc(normalizedCommand.docId);

    if (!currentDoc) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    seq = await docRealtimeService.allocateNextSeq(normalizedCommand.docId);
    updatedAt = new Date().toISOString();

    await docRealtimeService.saveRealtimeDoc(normalizedCommand.docId, {
      title: currentDoc.title,
      snapshotJson: applyImportSheetToRealtimeDoc({
        docId: normalizedCommand.docId,
        snapshotJson: normalizedCommand.snapshot,
      }),
      currentSeq: seq,
      updatedAt,
    });

    await docRealtimeService.saveUserOpState({
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      undoStackJson: [],
      redoStackJson: [],
      updatedAt,
    });

    await docRealtimeService.setBarrier(normalizedCommand.docId, {
      seq,
      opType: 'import_sheet',
      eventId: normalizedCommand.eventId ? String(normalizedCommand.eventId) : null,
      updatedAt,
    });

    await docRealtimeService.appendOp(normalizedCommand.docId, {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      opType: 'import_sheet',
      eventId: normalizedCommand.eventId ? String(normalizedCommand.eventId) : null,
      payloadJson: normalizedCommand.snapshot,
      createdAt: updatedAt,
    });

    await docsService.invalidateDocCaches(normalizedCommand.docId);

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
      snapshot: normalizedCommand.snapshot,
      canUndo: false,
      canRedo: false,
    };
  });
}

async function applyImportSheet(command = {}) {
  const normalizedCommand = normalizeImportSheetCommand(command);
  return executeImportSheet(normalizedCommand);
}

module.exports = {
  applyImportSheet,
};
