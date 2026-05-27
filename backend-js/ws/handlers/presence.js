const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const roomService = require('../../service/roomService');
const auditService = require('../../audit/auditService');
const { isNonEmptyString } = require('../../protocol/validators');

async function handlePresence({ socket, message, reply, broadcastToRoom }) {
  if (!isNonEmptyString(message.docId)) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId is required'));
    return;
  }

  const { docId } = message;
  const inRoom = await roomService.isSocketInRoom(docId, socket);

  if (!inRoom) {
    reply(createWsError(ERROR_CODES.FORBIDDEN, 'socket has not joined this document'));
    return;
  }

  const users = await roomService.getRoomUsers(docId);
  const payload = createWsSuccess('presence', { docId, users });

  reply(payload);
  await broadcastToRoom(docId, payload);

  await auditService.recordAuditEvent({ type: 'presence', docId });
}

module.exports = handlePresence;
