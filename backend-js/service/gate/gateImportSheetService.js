const { ERROR_CODES } = require('../../protocol/errorCodes');
const { normalizeDocSnapshot } = require('../../domain/entities/doc');
const docRealtimeStore = require('../../store/redis/docRealtimeStore');
const { realtimeKeys } = require('../../infra/redis/realtimeKeys');
const { createRealtimeClient } = require('../../infra/redis/realtimeClient');
const docsService = require('../docsService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

const barrierClient = createRealtimeClient('import-barrier');

// 返回 { seq, snapshot }
async function commitImportSheet(normalizedCommand) {
  const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
  if (!currentDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const nextSnapshot = normalizeDocSnapshot(normalizedCommand.snapshot, { docId: normalizedCommand.docId });

  const event = {
    opType: 'import_sheet',
    clientId: normalizedCommand.clientId,
    payloadJson: nextSnapshot,
  };

  const commitResult = await docsService.commitRealtimeOp(normalizedCommand.docId, {
    expectedBaseSeq: null,
    snapshotJson: nextSnapshot,
    event,
  });

  if (!commitResult.ok) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'concurrent modification, please retry', {
      docId: normalizedCommand.docId, currentSeq: commitResult.currentSeq,
    });
  }

  // 推进 barrier：记录 import_sheet 对应的 seq，OT rebase 读 stream 时遇到此 seq 返回 4090
  const redis = await barrierClient.ensureReady();
  if (redis) {
    await redis.set(realtimeKeys.barrierKey(normalizedCommand.docId), String(commitResult.seq));
  }

  return { seq: commitResult.seq, snapshot: nextSnapshot };
}

module.exports = { commitImportSheet };
