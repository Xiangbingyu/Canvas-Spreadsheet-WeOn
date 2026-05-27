const { createHash } = require('node:crypto');
const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const docsService = require('../../service/docsService');
const historyStore = require('../../store/historyStore');
const userOpStateStore = require('../../store/userOpStateStore');
const auditService = require('../../service/auditService');
const idempotencyService = require('../../idempotency/idempotencyService');
const { createImportSheetRequestKey } = require('../../idempotency/idempotencyKeys');
const { isNonEmptyString } = require('../../protocol/validators');

function isValidSnapshot(snapshot) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot);
}

function makeFingerprint(docId, clientId, snapshot) {
  const raw = `${docId}:${clientId}:${JSON.stringify(snapshot)}`;
  return createHash('md5').update(raw).digest('hex');
}

async function handleImportSheet({ message, reply, broadcastToRoom }) {
  const { docId, clientId, snapshot, eventId } = message;

  if (!isNonEmptyString(docId) || !isNonEmptyString(clientId) || !isValidSnapshot(snapshot)) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId and snapshot are required'));
    return;
  }

  const requestKey = createImportSheetRequestKey(eventId);

  if (requestKey) {
    const fingerprint = makeFingerprint(docId, clientId, snapshot);
    const cached = idempotencyService.getRemembered(requestKey);

    // 首次请求已完成：校验指纹后重放缓存的 success/error 响应。
    if (cached && typeof cached.then !== 'function') {
      if (cached.fingerprint !== fingerprint) {
        reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'eventId already used with different request content'));
        return;
      }
      if (cached.payload) reply(cached.payload);
      return;
    }

    // 首次请求仍在处理中（PENDING Promise）：等待它完成后校验指纹并重放同一份响应。
    if (cached && typeof cached.then === 'function') {
      const settled = await cached;
      if (settled.fingerprint !== fingerprint) {
        reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'eventId already used with different request content'));
        return;
      }
      if (settled.payload) reply(settled.payload);
      return;
    }

    // 当前是首次请求，用 Promise 占位，并发相同 eventId 的请求会 await 这个 Promise。
    let resolvePending;
    const pendingPromise = new Promise((resolve) => { resolvePending = resolve; });
    idempotencyService.remember(requestKey, pendingPromise);

    const settle = (payload) => {
      const result = { fingerprint, payload };
      idempotencyService.remember(requestKey, result);
      resolvePending(result);
      return result;
    };

    const settleError = (payload) => {
      idempotencyService.forget(requestKey);
      resolvePending({ fingerprint, payload });
    };

    let updatedDoc;
    try {
      updatedDoc = await docsService.applyImportSheet({ docId, snapshotJson: snapshot });
    } catch (err) {
      const payload = createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message);
      settleError(payload);
      reply(payload);
      return;
    }

    if (!updatedDoc) {
      const payload = createWsError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${docId}`);
      settleError(payload);
      reply(payload);
      return;
    }

    const seq = updatedDoc.currentSeq;

    try {
      await historyStore.append({
        docId,
        clientId,
        seq,
        opType: 'import_sheet',
        eventId: eventId ? String(eventId) : null,
        payloadJson: snapshot,
      });
    } catch (err) {
      if (err.code === 'HISTORY_DUPLICATE_EVENT_ID') {
        settleError(null);
        return;
      }
      const payload = createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message);
      settleError(payload);
      reply(payload);
      return;
    }

    await userOpStateStore.saveState({ docId, clientId, undoStackJson: [], redoStackJson: [] });
    await auditService.recordOperationAudit({ type: 'import_sheet', docId, clientId, seq });

    const responseData = { docId, clientId, seq, canUndo: false, canRedo: false };
    const successPayload = createWsSuccess('sheet_imported', responseData);
    settle(successPayload);

    reply(successPayload);
    await broadcastToRoom(docId, successPayload);
    return;
  }

  // 无 eventId：不做幂等控制，每次都执行写入。
  let updatedDoc;
  try {
    updatedDoc = await docsService.applyImportSheet({ docId, snapshotJson: snapshot });
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message));
    return;
  }

  if (!updatedDoc) {
    reply(createWsError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${docId}`));
    return;
  }

  const seq = updatedDoc.currentSeq;

  await historyStore.append({
    docId,
    clientId,
    seq,
    opType: 'import_sheet',
    eventId: null,
    payloadJson: snapshot,
  });

  await userOpStateStore.saveState({ docId, clientId, undoStackJson: [], redoStackJson: [] });
  await auditService.recordOperationAudit({ type: 'import_sheet', docId, clientId, seq });

  const responseData = { docId, clientId, seq, canUndo: false, canRedo: false };
  const payload = createWsSuccess('sheet_imported', responseData);
  reply(payload);
  await broadcastToRoom(docId, payload);
}

module.exports = handleImportSheet;
