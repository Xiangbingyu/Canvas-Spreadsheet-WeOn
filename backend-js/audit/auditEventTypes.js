const AUDIT_EVENT_TYPES = {
  DOC_CREATED: 'doc_created',
  JOIN: 'join',
  LEAVE: 'leave',
  PRESENCE: 'presence',
  SET_CELL: 'set_cell',
  INSERT_ROW: 'insert_row',
  DELETE_ROW: 'delete_row',
  INSERT_COL: 'insert_col',
  DELETE_COL: 'delete_col',
  SET_TITLE: 'set_title',
  ADD_SHEET: 'add_sheet',
  IMPORT_SHEET: 'import_sheet',
  UNDO: 'undo',
  REDO: 'redo',
};

module.exports = {
  AUDIT_EVENT_TYPES,
};
