const { createWsSuccess, createWsError } = require('../utils/response');
const { ERROR_CODES } = require('../protocol/errorCodes');
const docsService = require('./docsService');
const roomService = require('./roomService');
const auditService = require('../audit/auditService');
const { isNonEmptyString } = require('../protocol/validators');

const pendingJoinRequests = new Map();

async function getUsersWithFallback(docId) {
  try {
    return await roomService.getRoomUsers(docId);
  } catch (error) {
    console.error(`join room-user lookup failed for ${docId}:`, error);
    return [];
  }
}

async function recordAuditBestEffort(event, label) {
  try {
    await auditService.recordAuditEvent(event);
  } catch (error) {
    console.error(`join ${label} audit failed:`, error);
  }
}

async function executeJoin({ socket, docId, clientId, name, color }) {
  let docState;
  try {
    docState = await docsService.getDocState(docId);
  } catch (error) {
    return {
      replyPayload: createWsError(error.code || ERROR_CODES.INTERNAL_ERROR, error.message),
      broadcasts: [],
    };
  }

  let isNewlyOnline;
  let previousLeave;
  try {
    ({ isNewlyOnline, previousLeave } = await roomService.joinRoom(docId, socket, { clientId, name, color }));
  } catch (error) {
    return {
      replyPayload: createWsError(error.code || ERROR_CODES.INTERNAL_ERROR, error.message),
      broadcasts: [],
    };
  }

  const users = await getUsersWithFallback(docId);
  const ackPayload = createWsSuccess('join_ack', {
    docId,
    clientId,
    currentSeq: docState.currentSeq,
    snapshot: docState.snapshot,
    users,
  });

  const broadcasts = [];
  const previousLeaveIsSameDoc = previousLeave && previousLeave.docId === docId;

  if (isNewlyOnline) {
    broadcasts.push({
      docId,
      payload: createWsSuccess('presence', { docId, users }),
      label: `join presence broadcast failed for ${docId}`,
    });
  }

  if (previousLeave && previousLeave.isFullyOffline && !previousLeaveIsSameDoc) {
    const oldUsers = await getUsersWithFallback(previousLeave.docId);
    broadcasts.push({
      docId: previousLeave.docId,
      payload: createWsSuccess('presence', { docId: previousLeave.docId, users: oldUsers }),
      label: `join previous-room leave broadcast failed for ${previousLeave.docId}`,
    });
    await recordAuditBestEffort(
      { type: 'leave', docId: previousLeave.docId, clientId: previousLeave.clientId },
      'leave'
    );
  }

  await recordAuditBestEffort({ type: 'join', docId, clientId }, 'join');

  return {
    replyPayload: ackPayload,
    broadcasts,
  };
}

async function handleJoin({ socket, message }) {
  const { docId, clientId, name, color } = message;

  if (!isNonEmptyString(docId) || !isNonEmptyString(clientId)) {
    return {
      replyPayload: createWsError(ERROR_CODES.INVALID_PARAMS, 'docId and clientId are required'),
      broadcasts: [],
    };
  }

  const requestKey = `conn:${socket._connId}:${docId}:${clientId}`;
  const existing = pendingJoinRequests.get(requestKey);

  if (existing) {
    const settled = await existing;
    return {
      ...settled,
      replayOnly: true,
    };
  }

  let resolvePending;
  const pendingPromise = new Promise((resolve) => { resolvePending = resolve; });
  pendingJoinRequests.set(requestKey, pendingPromise);

  try {
    const result = await executeJoin({ socket, docId, clientId, name, color });
    pendingJoinRequests.delete(requestKey);
    resolvePending(result);
    return result;
  } catch (error) {
    const result = {
      replyPayload: createWsError(error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Internal server error'),
      broadcasts: [],
    };
    pendingJoinRequests.delete(requestKey);
    resolvePending(result);
    return result;
  }
}

module.exports = {
  handleJoin,
};
