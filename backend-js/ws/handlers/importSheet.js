const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const importService = require('../../service/importService');

async function handleImportSheet({ message, reply, broadcastToRoom }) {
  try {
    const responseData = await importService.applyImportSheet(message);
    const payload = createWsSuccess('sheet_imported', {
      docId: responseData.docId,
      clientId: responseData.clientId,
      seq: responseData.seq,
      snapshot: responseData.snapshot,
      canUndo: responseData.canUndo,
      canRedo: responseData.canRedo,
    });
    reply(payload);
    await broadcastToRoom(responseData.docId, payload);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleImportSheet;
