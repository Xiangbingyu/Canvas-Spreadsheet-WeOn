﻿﻿const WS_MESSAGE_TYPES = {
  JOIN: 'join',
  JOIN_ACK: 'join_ack',
  PRESENCE: 'presence',
  SET_CELL: 'set_cell',
  CELL_UPDATED: 'cell_updated',
  SET_TITLE: 'set_title',
  TITLE_UPDATED: 'title_updated',
  ADD_SHEET: 'add_sheet',
  SHEET_ADDED: 'sheet_added',
  IMPORT_SHEET: 'import_sheet',
  SHEET_IMPORTED: 'sheet_imported',
  UNDO: 'undo',
  UNDO_APPLIED: 'undo_applied',
  REDO: 'redo',
  REDO_APPLIED: 'redo_applied',
  ERROR: 'error',
};

module.exports = {
  WS_MESSAGE_TYPES,
};
