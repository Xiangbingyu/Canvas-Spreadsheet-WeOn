const WS_MESSAGE_TYPES = {
  JOIN: 'join',
  JOIN_ACK: 'join_ack',
  PRESENCE: 'presence',
  SET_CELL: 'set_cell',
  CELL_UPDATED: 'cell_updated',
  IMPORT_SHEET: 'import_sheet',
  SHEET_IMPORTED: 'sheet_imported',
  ERROR: 'error',
};

module.exports = {
  WS_MESSAGE_TYPES,
};
