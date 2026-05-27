const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const cellService = require('../../service/cellService');

async function handleSetCell({ message, reply, broadcastToRoom }) {
  try {
    const responseData = await cellService.applySetCell(message);
    const payload = createWsSuccess('cell_updated', responseData);
    reply(payload);
    await broadcastToRoom(responseData.docId, payload);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleSetCell;
