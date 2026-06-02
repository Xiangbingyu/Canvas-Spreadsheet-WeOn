const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const realtimeConfig = require('../config/realtimeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const roomService = require('./roomService');
const { normalizeDocSnapshot } = require('../domain/entities/doc');
const { commitImportSheet } = require('./gate/gateImportSheetService');

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

async function checkJoined(docId, clientId) {
  const users = await roomService.getRoomUsers(docId);
  const joined = users.some((u) => u.clientId === clientId);
  if (!joined) {
    throw createServiceError(ERROR_CODES.FORBIDDEN, 'must join the document before importing');
  }
}

async function executeImportSheet(normalizedCommand) {
  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let seq = 0;
    let resultSnapshot = null;

    if (realtimeConfig.driver === 'redis') {
      // commitImportSheet verifies doc exists first, then we check join
      const currentDoc = await docsService.getDocState(normalizedCommand.docId);
      if (!currentDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }
      await checkJoined(normalizedCommand.docId, normalizedCommand.clientId);
      const result = await commitImportSheet(normalizedCommand);
      seq = result.seq;
      resultSnapshot = result.snapshot;

      await userOpStateStore.saveState({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: [],
        redoStackJson: [],
      });
    } else {
      let updatedDoc = null;

      const executeMutation = async (connection = null) => {
        const docCheck = await docsService.getDocStateForWrite(normalizedCommand.docId, { connection, forUpdate: Boolean(connection) });
        if (!docCheck) {
          throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        }
        await checkJoined(normalizedCommand.docId, normalizedCommand.clientId);

        updatedDoc = await docsService.applyImportSheet({
          docId: normalizedCommand.docId,
          snapshotJson: normalizedCommand.snapshot,
        }, { connection });

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

      resultSnapshot = updatedDoc.snapshotJson;
    }

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
      snapshot: resultSnapshot,
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
