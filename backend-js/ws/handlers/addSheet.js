const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const addSheetService = require('../../service/addSheetService');
const roomService = require('../../service/roomService');

async function handleAddSheet({ socket, message, reply, broadcastToRoom }) {
  const { docId, clientId } = message;

  if (
    typeof docId !== 'string'
    || !docId.trim()
    || typeof clientId !== 'string'
    || !clientId.trim()
  ) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId and clientId are required'));
    return;
  }

  if (
    message.sheetName !== undefined
    && (typeof message.sheetName !== 'string' || !message.sheetName.trim())
  ) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'sheetName must be a non-empty string'));
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
    const responseData = await addSheetService.applyAddSheet(message);
    const payload = createWsSuccess('sheet_added', responseData);
    reply(payload);
    await broadcastToRoom(responseData.docId, payload);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleAddSheet;
