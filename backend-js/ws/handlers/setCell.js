const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const docsService = require('../../service/docsService');
const historyStore = require('../../store/historyStore');
const userOpStateStore = require('../../store/userOpStateStore');
const auditService = require('../../service/auditService');
const { isNonEmptyString } = require('../../protocol/validators');

function isValidCellPosition(value) {
  return Number.isInteger(value) && value >= 1;
}

async function handleSetCell({ message, reply, broadcastToRoom }) {
  const { docId, clientId, row, col, value, style } = message;

  if (!isNonEmptyString(docId) || !isNonEmptyString(clientId) || !isValidCellPosition(row) || !isValidCellPosition(col)) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, row and col are required'));
    return;
  }

  const newValue = value ?? '';
  const newStyle = style !== undefined ? style : null;

  // applySetCell 在同一临界区内读写，同时返回写前值（_before），避免并发读到过期旧值。
  let updatedDoc;
  try {
    updatedDoc = await docsService.applySetCell({ docId, row, col, value: newValue, style: newStyle });
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message));
    return;
  }

  if (!updatedDoc) {
    reply(createWsError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${docId}`));
    return;
  }

  const seq = updatedDoc.currentSeq;
  const { value: oldValue, style: oldStyle } = updatedDoc._before;

  await historyStore.append({
    docId,
    clientId,
    seq,
    opType: 'set_cell',
    targetRow: row,
    targetCol: col,
    oldValueJson: { value: oldValue, style: oldStyle },
    newValueJson: { value: newValue, style: newStyle },
  });

  const opState = await userOpStateStore.getState(docId, clientId);
  const undoStack = opState ? [...opState.undoStackJson] : [];
  undoStack.push({ sourceSeq: seq, docId, clientId, opType: 'set_cell', row, col, oldValue, oldStyle, newValue, newStyle });
  await userOpStateStore.saveState({ docId, clientId, undoStackJson: undoStack, redoStackJson: [] });

  await auditService.recordOperationAudit({ type: 'set_cell', docId, clientId, seq });

  const responseData = { docId, clientId, seq, row, col, value: newValue, style: newStyle, canUndo: true, canRedo: false };
  const payload = createWsSuccess('cell_updated', responseData);
  reply(payload);
  await broadcastToRoom(docId, payload);
}

module.exports = handleSetCell;
