const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const rangeValuesService = require('../../service/rangeValuesService');
const roomService = require('../../service/roomService');

async function handleSetRangeValues({ socket, message, reply, broadcastToRoom }) {
  const { docId, clientId, sheetId, cells } = message;

  const hasValidParams = (
    typeof docId === 'string' && docId.trim()
    && typeof clientId === 'string' && clientId.trim()
    && typeof sheetId === 'string' && sheetId.trim()
    && Array.isArray(cells) && cells.length > 0
  );

  if (!hasValidParams) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, sheetId and non-empty cells are required'));
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
    const responseData = await rangeValuesService.applySetRangeValues({
      ...message,
      sheetId: sheetId.trim(),
    });
    const payload = createWsSuccess('range_values_updated', responseData);
    reply(payload);
    await broadcastToRoom(responseData.docId, payload);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleSetRangeValues;
