const { ERROR_CODES } = require('../protocol/errorCodes');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const docRealtimeService = require('./docRealtimeService');
const auditService = require('../audit/auditService');
const { normalizeBaseSeq } = require('./cellOtService');
const { rebaseSetTitleCommand } = require('./titleOtService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeSetTitleCommand(command = {}) {
  const { docId, clientId, title } = command;

  if (typeof docId !== 'string' || !docId.trim() || typeof clientId !== 'string' || !clientId.trim()) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId and clientId are required');
  }

  if (typeof title !== 'string') {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'title must be a string');
  }

  const normalizedTitle = title.trim();

  if (!normalizedTitle) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'title must be a non-empty string');
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    title: normalizedTitle,
    baseSeq: normalizeBaseSeq(command.baseSeq),
  };
}

async function applySetTitle(command = {}) {
  const normalizedCommand = normalizeSetTitleCommand(command);
  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let currentDoc = null;
    let seq = 0;
    let updatedAt = null;
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

    const otResult = await rebaseSetTitleCommand({
      command: normalizedCommand,
      currentDoc,
    });

    rebaseResult = otResult.rebaseResult;
    seq = await docRealtimeService.allocateNextSeq(normalizedCommand.docId);
    updatedAt = new Date().toISOString();

    await docRealtimeService.saveRealtimeDoc(normalizedCommand.docId, {
      title: normalizedCommand.title,
      snapshotJson: currentDoc.snapshotJson,
      currentSeq: seq,
      updatedAt,
    });

    await docRealtimeService.appendOp(normalizedCommand.docId, {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      baseSeq: rebaseResult.baseSeq,
      opType: 'set_title',
      oldValueJson: { title: currentDoc.title },
      newValueJson: { title: normalizedCommand.title },
      createdAt: updatedAt,
    });

    await docsService.invalidateDocCaches(normalizedCommand.docId);

    await auditService.recordAuditEvent({
      type: 'set_title',
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      title: normalizedCommand.title,
    });

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      title: normalizedCommand.title,
    };
  });
}

module.exports = {
  applySetTitle,
};
