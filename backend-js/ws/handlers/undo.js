const { createWsSuccess, createWsError } = require('../../utils/response');
const { ERROR_CODES } = require('../../protocol/errorCodes');
const docsService = require('../../service/docsService');
const roomService = require('../../service/roomService');
const historyStore = require('../../store/historyStore');
const userOpStateStore = require('../../store/userOpStateStore');
const auditService = require('../../service/auditService');
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

async function appendHistoryBestEffort(entry) {
  try {
    await historyStore.append(entry);
  } catch (error) {
    console.error('undo history append failed:', error);
  }
}

async function saveOpStateBestEffort(state) {
  try {
    await userOpStateStore.saveState(state);
  } catch (error) {
    console.error('undo user-op-state save failed:', error);
  }
}

async function recordAuditBestEffort(event) {
  try {
    await auditService.recordOperationAudit(event);
  } catch (error) {
    console.error('undo audit failed:', error);
  }
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

  const opState = await userOpStateStore.getState(docId, clientId);
  const undoStack = opState ? [...opState.undoStackJson] : [];
  const redoStack = opState ? [...opState.redoStackJson] : [];

  if (undoStack.length === 0) {
    reply(createWsError(ERROR_CODES.INVALID_PARAMS, 'nothing to undo'));
    return;
  }

  const entry = undoStack.pop();

  let updatedDoc;
  try {
    updatedDoc = await docsService.applySetCell({
      docId,
      row: entry.row,
      col: entry.col,
      value: entry.oldValue,
      style: entry.oldStyle,
    });
  } catch (err) {
    reply(createWsError(err.code || ERROR_CODES.INTERNAL_ERROR, err.message));
    return;
  }

  if (!updatedDoc) {
    reply(createWsError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${docId}`));
    return;
  }

  const seq = updatedDoc.currentSeq;

  await appendHistoryBestEffort({
    docId,
    clientId,
    seq,
    opType: 'undo',
    sourceSeq: entry.sourceSeq,
    targetRow: entry.row,
    targetCol: entry.col,
    oldValueJson: { value: entry.newValue, style: entry.newStyle },
    newValueJson: { value: entry.oldValue, style: entry.oldStyle },
  });

  redoStack.push({ sourceSeq: entry.sourceSeq, docId, clientId, opType: 'set_cell', row: entry.row, col: entry.col, oldValue: entry.oldValue, oldStyle: entry.oldStyle, newValue: entry.newValue, newStyle: entry.newStyle });
  await saveOpStateBestEffort({ docId, clientId, undoStackJson: undoStack, redoStackJson: redoStack });

  await recordAuditBestEffort({ type: 'undo', docId, clientId, seq });

  const responseData = {
    docId,
    clientId,
    seq,
    row: entry.row,
    col: entry.col,
    value: entry.oldValue,
    style: entry.oldStyle,
    canUndo: undoStack.length > 0,
    canRedo: true,
  };
  const payload = createWsSuccess('undo_applied', responseData);
  reply(payload);
  await broadcastBestEffort(docId, payload, broadcastToRoom);
}

module.exports = handleUndo;
