const { ERROR_CODES } = require('../protocol/errorCodes');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const docRealtimeService = require('./docRealtimeService');
const auditService = require('../audit/auditService');
const { applyAddSheetToRealtimeDoc } = require('../utils/realtimeDocMutation');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeAddSheetCommand(command = {}) {
  const { docId, clientId, sheetName } = command;

  if (typeof docId !== 'string' || !docId.trim() || typeof clientId !== 'string' || !clientId.trim()) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId and clientId are required');
  }

  if (sheetName !== undefined && (typeof sheetName !== 'string' || !sheetName.trim())) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'sheetName must be a non-empty string');
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    sheetName: typeof sheetName === 'string' ? sheetName.trim() : null,
  };
}

async function applyAddSheet(command = {}) {
  const normalizedCommand = normalizeAddSheetCommand(command);

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let currentDoc = null;
    let seq = 0;
    let updatedAt = null;
    currentDoc = await docRealtimeService.getRealtimeDoc(normalizedCommand.docId);

    if (!currentDoc) {
      throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
    }

    const nextMutation = applyAddSheetToRealtimeDoc(currentDoc, {
      docId: normalizedCommand.docId,
      sheetName: normalizedCommand.sheetName,
    });

    seq = await docRealtimeService.allocateNextSeq(normalizedCommand.docId);
    updatedAt = new Date().toISOString();

    await docRealtimeService.saveRealtimeDoc(normalizedCommand.docId, {
      title: currentDoc.title,
      snapshotJson: nextMutation.nextSnapshot,
      currentSeq: seq,
      updatedAt,
    });

    await docRealtimeService.appendOp(normalizedCommand.docId, {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      opType: 'add_sheet',
      targetSheetId: nextMutation.addedSheet ? nextMutation.addedSheet.id : null,
      payloadJson: {
        sheet: nextMutation.addedSheet,
        activeSheetId: nextMutation.nextSnapshot.activeSheetId,
        sheetOrder: nextMutation.nextSnapshot.sheetOrder,
      },
      createdAt: updatedAt,
    });

    await docsService.invalidateDocCaches(normalizedCommand.docId);

    await auditService.recordAuditEvent({
      type: 'add_sheet',
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      sheetId: nextMutation.addedSheet ? nextMutation.addedSheet.id : null,
      sheetName: nextMutation.addedSheet ? nextMutation.addedSheet.name : null,
    });

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      sheet: nextMutation.addedSheet || null,
      activeSheetId: nextMutation.nextSnapshot.activeSheetId,
      sheetOrder: nextMutation.nextSnapshot.sheetOrder,
    };
  });
}

module.exports = {
  applyAddSheet,
};
