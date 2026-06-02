function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target || {}, key);
}

function normalizeBatchUpdates(payloadJson = {}) {
  const updates = Array.isArray(payloadJson.updates) ? payloadJson.updates : [];
  return updates.map((update) => ({
    row: update.row,
    col: update.col,
    value: hasOwn(update, 'newValue') ? update.newValue : '',
    style: hasOwn(update, 'newStyle') ? update.newStyle : null,
  }));
}

function buildDocStoreCommand(docId, event = {}) {
  switch (event.opType) {
    case 'set_cell':
      return {
        docId,
        seq: event.seq,
        sheetId: event.targetSheetId,
        row: event.targetRow,
        col: event.targetCol,
        value: hasOwn(event.newValueJson, 'value') ? event.newValueJson.value : '',
        style: hasOwn(event.newValueJson, 'style') ? event.newValueJson.style : null,
      };
    case 'batch_set_cell':
      return {
        docId,
        seq: event.seq,
        sheetId: event.payloadJson && event.payloadJson.sheetId
          ? event.payloadJson.sheetId
          : event.targetSheetId,
        updates: normalizeBatchUpdates(event.payloadJson),
      };
    case 'set_title':
      return {
        docId,
        seq: event.seq,
        title: hasOwn(event.newValueJson, 'title') ? event.newValueJson.title : '',
      };
    case 'add_sheet':
      return {
        docId,
        seq: event.seq,
        sheetName: event.payloadJson && event.payloadJson.sheet
          ? event.payloadJson.sheet.name
          : null,
      };
    case 'import_sheet':
      return {
        docId,
        seq: event.seq,
        snapshotJson: event.payloadJson,
      };
    case 'undo':
    case 'redo':
      if (event.payloadJson && event.payloadJson.type === 'batch_set_cell') {
        return {
          docId,
          seq: event.seq,
          sheetId: event.payloadJson.sheetId || event.targetSheetId,
          updates: normalizeBatchUpdates(event.payloadJson),
        };
      }
      return {
        docId,
        seq: event.seq,
        sheetId: event.targetSheetId,
        row: event.targetRow,
        col: event.targetCol,
        value: hasOwn(event.newValueJson, 'value') ? event.newValueJson.value : '',
        style: hasOwn(event.newValueJson, 'style') ? event.newValueJson.style : null,
      };
    case 'insert_row':
    case 'delete_row':
    case 'insert_col':
    case 'delete_col':
      return {
        docId,
        seq: event.seq,
        opType: event.opType,
        sheetId: event.targetSheetId,
        row: event.targetRow,
        col: event.targetCol,
      };
    default:
      return null;
  }
}

async function applyReplayEvent(docStore, docId, event = {}) {
  const cmd = buildDocStoreCommand(docId, event);
  if (!cmd) {
    return null;
  }

  switch (event.opType) {
    case 'set_cell':
      return docStore.applySetCell(cmd);
    case 'batch_set_cell':
      return docStore.applyBatchSetCell(cmd);
    case 'set_title':
      return docStore.applySetTitle(cmd);
    case 'add_sheet':
      return docStore.applyAddSheet(cmd);
    case 'import_sheet':
      return docStore.applyImportSheet(cmd);
    case 'undo':
    case 'redo':
      return cmd.updates
        ? docStore.applyBatchSetCell(cmd)
        : docStore.applySetCell(cmd);
    case 'insert_row':
    case 'delete_row':
    case 'insert_col':
    case 'delete_col':
      return docStore.applySheetStructureChange(cmd);
    default:
      return null;
  }
}

function isHistoryDuplicateError(error) {
  const message = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`;
  return /duplicate|dup_entry|history_duplicate_doc_seq/i.test(message);
}

function computeNextCheckpoint(currentCheckpoint, currentSeq, retainCount) {
  const safeCurrentCheckpoint = Number.isInteger(currentCheckpoint) ? currentCheckpoint : 0;
  const safeCurrentSeq = Number.isInteger(currentSeq) ? currentSeq : 0;
  const safeRetainCount = Number.isInteger(retainCount) && retainCount > 0 ? retainCount : 0;
  return Math.max(safeCurrentCheckpoint, Math.max(0, safeCurrentSeq - safeRetainCount));
}

module.exports = {
  applyReplayEvent,
  buildDocStoreCommand,
  isHistoryDuplicateError,
  computeNextCheckpoint,
};
