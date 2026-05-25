const { createWsSuccess, createWsError } = require('../../utils/response');

function broadcastPresence({ docId, broadcastToRoom }) {
  if (!docId) {
    return;
  }

  // TODO: read online users from roomUsers store and broadcast real presence.
  broadcastToRoom(
    docId,
    createWsSuccess('presence', {
      docId,
      users: [],
    }, 'presence placeholder')
  );
}

function handlePresence({ message, reply, broadcastToRoom }) {
  if (!message.docId) {
    reply(createWsError(4000, 'docId is required'));
    return;
  }

  const payload = createWsSuccess('presence', {
    docId: message.docId,
    users: [],
  }, 'presence placeholder');

  reply(payload);
  broadcastToRoom(message.docId, payload);
}

module.exports = handlePresence;
module.exports.broadcastPresence = broadcastPresence;
