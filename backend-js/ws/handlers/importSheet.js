const { createWsSuccess, createWsError } = require('../../utils/response');

function isValidSnapshot(snapshot) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot);
}

async function handleImportSheet({ message, reply, broadcastToRoom }) {
  if (!message.docId || !message.clientId || !isValidSnapshot(message.snapshot)) {
    reply(createWsError(4000, 'docId, clientId and snapshot are required'));
    return;
  }

  // TODO: replace current document snapshot and broadcast sheet_imported.
  reply(
    createWsSuccess('sheet_imported', {
      docId: message.docId,
      clientId: message.clientId,
    }, 'import_sheet placeholder')
  );
}

module.exports = handleImportSheet;
