const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const { normalizeDocSnapshot } = require('../domain/entities/doc');
const docStateCache = require('../cache/docStateCache');
const historyCache = require('../cache/historyCache');
const asyncWriteQueue = require('../infra/asyncWriteQueue');

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
    let updatedDoc = null;
    let seq = 0;

    if (storeConfig.driver === 'mysql') {
      await asyncWriteQueue.drain();
    }

    const executeMutation = async (connection = null) => {
      updatedDoc = await docsService.applyImportSheet({
        docId: normalizedCommand.docId,
        snapshotJson: normalizedCommand.snapshot,
      }, {
        connection,
      });

      if (!updatedDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      seq = updatedDoc.currentSeq;

      await historyStore.append({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        seq,
        opType: 'import_sheet',
        eventId: normalizedCommand.eventId ? String(normalizedCommand.eventId) : null,
        payloadJson: normalizedCommand.snapshot,
      }, { connection });

      await userOpStateStore.saveState({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: [],
        redoStackJson: [],
      }, { connection });
    };

    if (storeConfig.driver === 'mysql') {
      await withTransaction(async (connection) => executeMutation(connection));
    } else {
      await executeMutation();
    }

    // importSheet is a full replacement — invalidate memory caches before repopulating
    historyCache.invalidateByDocId(normalizedCommand.docId);
    docStateCache.invalidate(normalizedCommand.docId);
    docStateCache.set(normalizedCommand.docId, updatedDoc);
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
      snapshot: updatedDoc.snapshotJson,
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
