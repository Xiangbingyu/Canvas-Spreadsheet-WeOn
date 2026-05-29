const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const titleService = require('../../service/titleService');
const roomService = require('../../service/roomService');

async function handleSetTitle({ socket, message, reply, broadcastToRoom }) {
  const { docId, clientId } = message;

  if (
    typeof docId === 'string'
    && docId.trim()
    && typeof clientId === 'string'
    && clientId.trim()
    && typeof message.title === 'string'
    && message.title.trim()
  ) {
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
    const responseData = await titleService.applySetTitle(message);
    const payload = createWsSuccess('title_updated', responseData);
    reply(payload);
    await broadcastToRoom(responseData.docId, payload);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleSetTitle;
