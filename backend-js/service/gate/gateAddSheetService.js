const { ERROR_CODES } = require('../../protocol/errorCodes');
const { buildNextSheetId, buildDefaultSheetName, createEmptySheetSnapshot, normalizeDocSnapshot } = require('../../domain/entities/doc');
const docsService = require('../docsService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

// 返回 { seq, addedSheet, activeSheetId, sheetOrder }
async function commitAddSheet(normalizedCommand) {
  const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
  if (!currentDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const nextSnapshot = JSON.parse(JSON.stringify(
    normalizeDocSnapshot(currentDoc.snapshotJson, { docId: normalizedCommand.docId })
  ));
  const nextSheetId = buildNextSheetId(nextSnapshot, normalizedCommand.docId);
  const nextSheet = createEmptySheetSnapshot({
    docId: normalizedCommand.docId,
    sheetId: nextSheetId,
    name: normalizedCommand.sheetName || buildDefaultSheetName(nextSnapshot),
  });

  nextSnapshot.sheets[nextSheetId] = nextSheet;
  nextSnapshot.sheetOrder = [...(nextSnapshot.sheetOrder || []), nextSheetId];
  nextSnapshot.activeSheetId = nextSheetId;

  const event = {
    opType: 'add_sheet',
    targetSheetId: nextSheetId,
    clientId: normalizedCommand.clientId,
    payloadJson: {
      sheet: nextSheet,
      activeSheetId: nextSnapshot.activeSheetId,
      sheetOrder: nextSnapshot.sheetOrder,
    },
  };

  const commitResult = await docsService.commitRealtimeOp(normalizedCommand.docId, {
    expectedBaseSeq: null,
    snapshotJson: nextSnapshot,
    event,
  });

  if (!commitResult.ok) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'concurrent modification, please retry', {
      docId: normalizedCommand.docId, currentSeq: commitResult.currentSeq,
    });
  }

  return {
    seq: commitResult.seq,
    addedSheet: nextSheet,
    activeSheetId: nextSnapshot.activeSheetId,
    sheetOrder: nextSnapshot.sheetOrder,
  };
}

module.exports = { commitAddSheet };
