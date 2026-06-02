const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const realtimeConfig = require('../config/realtimeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const auditService = require('../audit/auditService');
const { normalizeBaseSeq } = require('./cellOtService');
const { rebaseSetTitleCommand } = require('./titleOtService');
const { commitSetTitle } = require('./gate/gateSetTitleService');

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
    let seq = 0;
    let oldTitle = null;
    let rebaseResult = { enabled: false, rebased: false, baseSeq: null, conflictSeq: null };

    if (realtimeConfig.driver === 'redis') {
      const result = await commitSetTitle(normalizedCommand);
      seq = result.seq;
      oldTitle = result.oldTitle;
      rebaseResult = result.rebaseResult;
    } else {
      let updatedDoc = null;

      const executeMutation = async (connection = null) => {
        const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId, {
          connection, forUpdate: Boolean(connection),
        });

        if (!currentDoc) {
          throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        }

        const otResult = await rebaseSetTitleCommand({ command: normalizedCommand, currentDoc });
        rebaseResult = otResult.rebaseResult;

        updatedDoc = await docsService.applySetTitle({ ...otResult.command }, { connection });

        if (!updatedDoc) {
          throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        }

        seq = updatedDoc.currentSeq;
        oldTitle = updatedDoc._before.title;

        await historyStore.append({
          docId: normalizedCommand.docId, clientId: normalizedCommand.clientId,
          seq, baseSeq: rebaseResult.baseSeq, opType: 'set_title',
          oldValueJson: { title: oldTitle },
          newValueJson: { title: normalizedCommand.title },
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
      type: 'set_title', docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId, seq, title: normalizedCommand.title,
    });

    return { docId: normalizedCommand.docId, clientId: normalizedCommand.clientId, seq, title: normalizedCommand.title };
  });
}

module.exports = {
  applySetTitle,
};
