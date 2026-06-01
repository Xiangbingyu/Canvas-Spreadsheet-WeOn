const handleJoin = require('./handlers/join');
const handlePresence = require('./handlers/presence');
const handleCursor = require('./handlers/cursor');
const handleSetCell = require('./handlers/setCell');
const handleInsertRow = require('./handlers/insertRow');
const handleDeleteRow = require('./handlers/deleteRow');
const handleInsertCol = require('./handlers/insertCol');
const handleDeleteCol = require('./handlers/deleteCol');
const handleSetTitle = require('./handlers/setTitle');
const handleAddSheet = require('./handlers/addSheet');
const handleImportSheet = require('./handlers/importSheet');
const handleUndo = require('./handlers/undo');
const handleRedo = require('./handlers/redo');
const { ERROR_CODES } = require('../protocol/errorCodes');
const { WS_MESSAGE_TYPES } = require('../protocol/messageTypes');
const { createWsError } = require('../utils/response');

const handlers = {
  [WS_MESSAGE_TYPES.JOIN]: handleJoin,
  [WS_MESSAGE_TYPES.PRESENCE]: handlePresence,
  [WS_MESSAGE_TYPES.CURSOR]: handleCursor,
  [WS_MESSAGE_TYPES.SET_CELL]: handleSetCell,
  [WS_MESSAGE_TYPES.INSERT_ROW]: handleInsertRow,
  [WS_MESSAGE_TYPES.DELETE_ROW]: handleDeleteRow,
  [WS_MESSAGE_TYPES.INSERT_COL]: handleInsertCol,
  [WS_MESSAGE_TYPES.DELETE_COL]: handleDeleteCol,
  [WS_MESSAGE_TYPES.SET_TITLE]: handleSetTitle,
  [WS_MESSAGE_TYPES.ADD_SHEET]: handleAddSheet,
  [WS_MESSAGE_TYPES.IMPORT_SHEET]: handleImportSheet,
  [WS_MESSAGE_TYPES.UNDO]: handleUndo,
  [WS_MESSAGE_TYPES.REDO]: handleRedo,
};

async function dispatchMessage(context) {
  const handler = handlers[context.message && context.message.type];

  if (!handler) {
    context.reply(createWsError(ERROR_CODES.UNSUPPORTED_MESSAGE_TYPE, 'Unsupported message type'));
    return;
  }

  try {
    await handler(context);
  } catch (error) {
    console.error('WebSocket handler error:', error);
    context.reply(createWsError(ERROR_CODES.INTERNAL_ERROR, 'Internal server error'));
  }
}

module.exports = dispatchMessage;
