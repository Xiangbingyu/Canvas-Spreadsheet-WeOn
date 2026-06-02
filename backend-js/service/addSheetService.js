const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const realtimeConfig = require('../config/realtimeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const auditService = require('../audit/auditService');
const { commitAddSheet } = require('./gate/gateAddSheetService');

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
    let seq = 0;
    let addedSheet = null;
    let activeSheetId = null;
    let sheetOrder = [];

    if (realtimeConfig.driver === 'redis') {
      const result = await commitAddSheet(normalizedCommand);
      seq = result.seq;
      addedSheet = result.addedSheet;
      activeSheetId = result.activeSheetId;
      sheetOrder = result.sheetOrder;
    } else {
      let updatedDoc = null;

      const executeMutation = async (connection = null) => {
        const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId, {
          connection, forUpdate: Boolean(connection),
        });

        if (!currentDoc) {
          throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        }

        updatedDoc = await docsService.applyAddSheet({
          docId: normalizedCommand.docId, sheetName: normalizedCommand.sheetName,
        }, { connection });

        if (!updatedDoc) {
          throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        }

        seq = updatedDoc.currentSeq;
        addedSheet = updatedDoc._addedSheet;
        activeSheetId = updatedDoc.snapshotJson.activeSheetId;
        sheetOrder = updatedDoc.snapshotJson.sheetOrder;

        await historyStore.append({
          docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
          seq, opType: 'add_sheet',
          targetSheetId: addedSheet ? addedSheet.id : null,
          payloadJson: { sheet: addedSheet, activeSheetId, sheetOrder },
        }, { connection });
      };

      if (storeConfig.driver === 'mysql') {
        await withTransaction(async (connection) => executeMutation(connection));
      } else {
        await executeMutation();
      }
    }

    await docsService.invalidateDocCaches(normalizedCommand.docId);
    await auditService.recordAuditEvent({
      type: 'add_sheet', docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
      seq, sheetId: addedSheet ? addedSheet.id : null, sheetName: addedSheet ? addedSheet.name : null,
    });

    return {
      docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
      seq, sheet: addedSheet, activeSheetId, sheetOrder,
    };
  });
}

module.exports = {
  applyAddSheet,
};
