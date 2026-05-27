const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const roomService = require('../../service/roomService');
const historyStore = require('../../store/historyStore');
const undoRedoService = require('../../service/undoRedoService');
const { isNonEmptyString } = require('../../protocol/validators');

async function isSocketAuthorizedForUndoRedo(socket, docId, clientId) {
  const membership = await roomService.getSocketMembership(socket);
  return Boolean(
    membership
    && membership.status === 'connected'
    && membership.docId === docId
    && membership.clientId === clientId
  );
}

async function broadcastBestEffort(docId, payload, broadcastToRoom) {
  try {
    await broadcastToRoom(docId, payload);
  } catch (error) {
    console.error(`undo broadcast failed for ${docId}:`, error);
  }
}

async function handleUndo({ socket, message, reply, broadcastToRoom }) {
  const { docId, clientId } = message;

  if (!isNonEmptyString(docId) || !isNonEmptyString(clientId)) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId and clientId are required'));
    return;
  }

  if (!(await isSocketAuthorizedForUndoRedo(socket, docId, clientId))) {
    reply(createWsError(ERROR_CODES.FORBIDDEN, 'socket has not joined this document as the specified client'));
    return;
  }

  try {
    const responseData = await undoRedoService.applyUndo({
      docId,
      clientId,
      historyStore,
    });
    const payload = createWsSuccess('undo_applied', responseData);
    reply(payload);
    await broadcastBestEffort(docId, payload, broadcastToRoom);
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleUndo;
