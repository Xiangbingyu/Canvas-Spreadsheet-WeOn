const { createWsSuccess, createWsError } = require('../../utils/response');

async function handleUndo({ message, reply }) {
  if (!message.docId || !message.clientId) {
    reply(createWsError(4000, 'docId and clientId are required'));
    return;
  }

  reply(
    createWsSuccess('undo_applied', {
      docId: message.docId,
      clientId: message.clientId,
    }, 'undo placeholder')
  );
}

module.exports = handleUndo;
