const handleJoin = require('./handlers/join');
const handlePresence = require('./handlers/presence');
const handleSetCell = require('./handlers/setCell');
const handleImportSheet = require('./handlers/importSheet');
const { createWsError } = require('../utils/response');

const handlers = {
  join: handleJoin,
  presence: handlePresence,
  set_cell: handleSetCell,
  import_sheet: handleImportSheet,
};

async function dispatchMessage(context) {
  const handler = handlers[context.message && context.message.type];

  if (!handler) {
    context.reply(createWsError(4001, 'Unsupported message type'));
    return;
  }

  try {
    await handler(context);
  } catch (error) {
    console.error('WebSocket handler error:', error);
    context.reply(createWsError(5000, 'Internal server error'));
  }
}

module.exports = dispatchMessage;
