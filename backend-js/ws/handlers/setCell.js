const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const cellService = require('../../service/cellService');
const roomService = require('../../service/roomService');

function isValidCellPosition(value) {
  return Number.isInteger(value) && value >= 1;
}

function isValidSheetId(value) {
  return typeof value === 'string' && value.trim();
}

async function handleSetCell({ socket, message, reply, broadcastToRoom }) {
  const { docId, clientId, sheetId } = message;
  const hasValidParams = (
    typeof docId === 'string'
    && docId.trim()
    && typeof clientId === 'string'
    && clientId.trim()
    && isValidSheetId(sheetId)
    && isValidCellPosition(message.row)
    && isValidCellPosition(message.col)
  );

  if (!hasValidParams) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, sheetId, row and col are required'));
    return;
  }

  if (hasValidParams) {
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
  }

  try {
    const responseData = await cellService.applySetCell({
      ...message,
      sheetId: sheetId.trim(),
    });
    const payload = createWsSuccess('cell_updated', responseData);
    reply(payload);
    await broadcastToRoom(responseData.docId, payload);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleSetCell;
