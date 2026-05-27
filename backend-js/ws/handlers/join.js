const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const docsService = require('../../service/docsService');
const roomService = require('../../service/roomService');
const presenceService = require('../../service/presenceService');
const idempotencyService = require('../../idempotency/idempotencyService');
const { createJoinRequestKey } = require('../../idempotency/idempotencyKeys');
const auditService = require('../../service/auditService');
const { isNonEmptyString } = require('../../protocol/validators');

async function getUsersWithFallback(docId) {
  try {
    const { users } = await presenceService.getPresence(docId);
    return users;
  } catch (error) {
    console.error(`join presence lookup failed for ${docId}, fallback to room users:`, error);
  }

  try {
    return await roomService.getRoomUsers(docId);
  } catch (fallbackError) {
    console.error(`join room-user fallback failed for ${docId}:`, fallbackError);
    return [];
  }
}

async function recordAuditBestEffort(event, label) {
  try {
    await auditService.recordOperationAudit(event);
  } catch (error) {
    console.error(`join ${label} audit failed:`, error);
  }
}

async function handleJoin({ socket, message, reply, broadcastToRoom }) {
  const { docId, clientId, name, color } = message;

  if (!isNonEmptyString(docId) || !isNonEmptyString(clientId)) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId and clientId are required'));
    return;
  }

  // 幂等 key 防同一连接在同一时刻的并发重复消息。
  // 用 Promise 占位：并发的第二条等待第一条完成后重放同一份 success/error payload，
  // 确保客户端总能收到响应（成功或失败）。
  // 成功后主动清除 key，使切房后再次 join 旧房间时能正常重新入房。
  // 失败时同样清除 key，允许客户端在修正参数后重试。
  const requestKey = createJoinRequestKey(`conn:${socket._connId}:${docId}:${clientId}`);
  const existing = idempotencyService.getRemembered(requestKey);

  if (existing && typeof existing.then === 'function') {
    const settled = await existing;
    if (settled.payload) reply(settled.payload);
    return;
  }

  let resolvePending;
  const pendingPromise = new Promise((resolve) => { resolvePending = resolve; });
  idempotencyService.remember(requestKey, pendingPromise);

  const settleError = (payload) => {
    idempotencyService.forget(requestKey);
    resolvePending({ payload });
  };
  const settleSuccess = (payload) => {
    idempotencyService.forget(requestKey);
    resolvePending({ payload });
  };

  let docState;
  try {
    docState = await docsService.getDocState(docId);
  } catch (err) {
    const payload = createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message);
    settleError(payload);
    reply(payload);
    return;
  }

  let isNewlyOnline, previousLeave;
  try {
    ({ isNewlyOnline, previousLeave } = await roomService.joinRoom(docId, socket, { clientId, name, color }));
  } catch (err) {
    const payload = createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message);
    settleError(payload);
    reply(payload);
    return;
  }

  // joinRoom 成功后视为“加入已提交”：
  // 后续读取在线列表/广播/审计失败都只做内部兜底，不再把本次 join 反向打成失败。
  const users = await getUsersWithFallback(docId);

  const ackData = { docId, clientId, currentSeq: docState.currentSeq, snapshot: docState.snapshot, users };
  const ackPayload = createWsSuccess('join_ack', ackData);

  settleSuccess(ackPayload);
  reply(ackPayload);

  // 同文档切 clientId：previousLeave.docId === docId，此时 isNewlyOnline 已为 true，
  // 旧用户下线与新用户上线的最终 users 列表相同，只需广播一次，跳过重复广播。
  const previousLeaveIsSameDoc = previousLeave && previousLeave.docId === docId;

  if (isNewlyOnline) {
    try {
      await broadcastToRoom(docId, createWsSuccess('presence', { docId, users }));
    } catch (error) {
      console.error(`join presence broadcast failed for ${docId}:`, error);
    }
  }

  if (previousLeave && previousLeave.isFullyOffline && !previousLeaveIsSameDoc) {
    const oldUsers = await getUsersWithFallback(previousLeave.docId);
    try {
      await broadcastToRoom(previousLeave.docId, createWsSuccess('presence', { docId: previousLeave.docId, users: oldUsers }));
    } catch (error) {
      console.error(`join previous-room leave broadcast failed for ${previousLeave.docId}:`, error);
    }
    await recordAuditBestEffort(
      { type: 'leave', docId: previousLeave.docId, clientId: previousLeave.clientId },
      'leave'
    );
  }

  await recordAuditBestEffort({ type: 'join', docId, clientId }, 'join');
}

module.exports = handleJoin;
