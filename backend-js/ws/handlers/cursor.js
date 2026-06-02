const { createWsSuccess } = require('../../utils/response');
const { WS_MESSAGE_TYPES } = require('../../protocol/messageTypes');
const { buildCursorBroadcast } = require('../../service/gate/gateCursorService');

async function handleCursor({ message, broadcastToRoom }) {
  const payload = createWsSuccess(WS_MESSAGE_TYPES.CURSOR_UPDATE, buildCursorBroadcast(message));
  await broadcastToRoom(message.docId, payload);
}

module.exports = handleCursor;
