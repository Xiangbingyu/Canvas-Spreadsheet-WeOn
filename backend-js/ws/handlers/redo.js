const { createWsSuccess, createWsError } = require('../../utils/response');

async function handleRedo({ message, reply }) {
  if (!message.docId || !message.clientId) {
    reply(createWsError(4000, 'docId and clientId are required'));
    return;
  }

  reply(
    createWsSuccess('redo_applied', {
      docId: message.docId,
      clientId: message.clientId,
    }, 'redo placeholder')
  );
}

module.exports = handleRedo;
