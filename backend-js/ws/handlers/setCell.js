const { createWsSuccess, createWsError } = require('../../utils/response');

function isValidCellPosition(value) {
  return Number.isInteger(value) && value >= 1;
}

async function handleSetCell({ message, reply, broadcastToRoom }) {
  if (
    !message.docId ||
    !message.clientId ||
    !isValidCellPosition(message.row) ||
    !isValidCellPosition(message.col)
  ) {
    reply(createWsError(4000, 'docId, clientId, row and col are required'));
    return;
  }

  // TODO: apply cell change into docs store and broadcast cell_updated.
  reply(
    createWsSuccess('cell_updated', {
      docId: message.docId,
      clientId: message.clientId,
      row: message.row,
      col: message.col,
      value: message.value ?? '',
    }, 'set_cell placeholder')
  );
}

module.exports = handleSetCell;
