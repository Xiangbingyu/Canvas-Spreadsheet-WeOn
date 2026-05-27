const { createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const joinService = require('../../service/joinService');

async function handleJoin({ socket, message, reply, broadcastToRoom }) {
  try {
    const result = await joinService.handleJoin({ socket, message });

    if (result.replyPayload) {
      reply(result.replyPayload);
    }

    if (!result.replayOnly) {
      for (const broadcast of result.broadcasts) {
        try {
          await broadcastToRoom(broadcast.docId, broadcast.payload);
        } catch (error) {
          console.error(`${broadcast.label}:`, error);
        }
      }
    }
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message, err.details || null));
  }
}

module.exports = handleJoin;
