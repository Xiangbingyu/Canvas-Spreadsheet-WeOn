const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const batchCellService = require('../../service/batchCellService');
const roomService = require('../../service/roomService');

function isValidSheetId(value) {
  return typeof value === 'string' && value.trim();
}

function isValidCellPosition(value) {
  return Number.isInteger(value) && value >= 1;
}

function hasValidUpdates(updates) {
  return Array.isArray(updates)
    && updates.length > 0
    && updates.every((update) => update && isValidCellPosition(update.row) && isValidCellPosition(update.col));
}

async function handleBatchSetCell({ socket, message, reply, broadcastToRoom }) {
  const { docId, clientId, sheetId } = message;
  const hasValidParams = (
    typeof docId === 'string'
    && docId.trim()
    && typeof clientId === 'string'
    && clientId.trim()
    && isValidSheetId(sheetId)
    && hasValidUpdates(message.updates)
    && (message.value !== undefined || message.style !== undefined)
  );

  if (!hasValidParams) {
    reply(createWsError(
      ERROR_CODES.INVALID_PARAMS,
      'docId, clientId, sheetId, updates and at least one of value/style are required'
    ));
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
    const responseData = await batchCellService.applyBatchSetCell({
      ...message,
      sheetId: sheetId.trim(),
    });
    const payload = createWsSuccess('batch_cell_updated', responseData);
    reply(payload);
    await broadcastToRoom(responseData.docId, payload);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleBatchSetCell;
