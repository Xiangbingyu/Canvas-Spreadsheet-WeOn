const { ERROR_CODES } = require('../../protocol/errorCodes');
const { validateSheetStructureChange, applySheetStructureChangeToSnapshot } = require('../../utils/sheetStructure');
const docsService = require('../docsService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

// 返回 { seq, targetSheetId }
async function commitStructureChange(normalizedCommand) {
  const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
  if (!currentDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const validation = validateSheetStructureChange(currentDoc.snapshotJson, normalizedCommand);
  if (!validation.ok) {
    if (validation.reason === 'sheet_not_found') {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${normalizedCommand.sheetId}`, {
        docId: normalizedCommand.docId, sheetId: normalizedCommand.sheetId,
      });
    }
    const field = validation.positionField;
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, `${field} out of range`, {
      docId: normalizedCommand.docId, sheetId: normalizedCommand.sheetId,
      [field]: validation.positionValue, upperBound: validation.upperBound,
    });
  }

  const result = applySheetStructureChangeToSnapshot(currentDoc.snapshotJson, normalizedCommand);
  if (!result.ok) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'structure change failed');
  }

  const event = {
    opType: normalizedCommand.opType,
    targetSheetId: result.targetSheetId,
    targetRow: normalizedCommand.row,
    targetCol: normalizedCommand.col,
    clientId: normalizedCommand.clientId,
  };

  const commitResult = await docsService.commitRealtimeOp(normalizedCommand.docId, {
    expectedBaseSeq: null,
    snapshotJson: result.nextSnapshot,
    event,
  });

  if (!commitResult.ok) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'concurrent modification, please retry', {
      docId: normalizedCommand.docId, currentSeq: commitResult.currentSeq,
    });
  }

  return { seq: commitResult.seq, targetSheetId: result.targetSheetId };
}

module.exports = { commitStructureChange };
