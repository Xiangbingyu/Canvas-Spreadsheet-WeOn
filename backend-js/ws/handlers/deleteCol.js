const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const { WS_MESSAGE_TYPES } = require('../../protocol/messageTypes');
const sheetStructureService = require('../../service/sheetStructureService');
const roomService = require('../../service/roomService');

async function handleDeleteCol({ socket, message, reply, broadcastToRoom }) {
  const { docId, clientId, sheetId, col } = message;

  if (
    typeof docId !== 'string'
    || !docId.trim()
    || typeof clientId !== 'string'
    || !clientId.trim()
    || typeof sheetId !== 'string'
    || !sheetId.trim()
    || !Number.isInteger(col)
    || col < 1
  ) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, sheetId and col are required'));
    return;
  }

  const membership = await roomService.getSocketMembership(socket);
  const hasJoinedCurrentRoom = Boolean(
    membership
    && membership.status === 'connected'
    && membership.docId === docId
    && membership.clientId === clientId
  );

  if (!hasJoinedCurrentRoom) {
    reply(createWsError(ERROR_CODES.FORBIDDEN, 'socket has not joined this document as the specified client'));
    return;
  }

  try {
    const responseData = await sheetStructureService.applyDeleteCol(message);
    const payload = createWsSuccess(WS_MESSAGE_TYPES.COL_DELETED, responseData);
    reply(payload);
    await broadcastToRoom(responseData.docId, payload);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleDeleteCol;
