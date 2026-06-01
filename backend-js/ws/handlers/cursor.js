const { createWsSuccess } = require('../../utils/response');
const { WS_MESSAGE_TYPES } = require('../../protocol/messageTypes');

async function handleCursor({ message, broadcastToRoom }) {
  const payload = createWsSuccess(WS_MESSAGE_TYPES.CURSOR_UPDATE, {
    docId: message.docId,
    clientId: message.clientId,
    row: message.row,
    col: message.col,
  });

  await broadcastToRoom(message.docId, payload);
}

module.exports = handleCursor;
