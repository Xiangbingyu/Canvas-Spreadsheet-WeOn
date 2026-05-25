const { createWsSuccess, createWsError } = require('../../utils/response');

async function handleJoin({ socket, message, reply, broadcastToRoom }) {
  if (!message.docId || !message.clientId) {
    reply(createWsError(4000, 'docId and clientId are required'));
    return;
  }

  // TODO: validate document, register socket and user, then broadcast presence.
  reply(
    createWsSuccess('join_ack', {
      docId: message.docId,
      clientId: message.clientId,
      snapshot: null,
      users: [],
    }, 'join placeholder')
  );
}

module.exports = handleJoin;
