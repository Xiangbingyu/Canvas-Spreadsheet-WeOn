const { ERROR_CODES } = require('../../protocol/errorCodes');
const { normalizeDocSnapshot } = require('../../domain/entities/doc');
const docRealtimeStore = require('../../store/redis/docRealtimeStore');
const docsService = require('../docsService');
const { rebaseBatchSetCellCommand } = require('../cellOtService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function findOrCreateStyleId(sheet, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return null;
  const styleKey = JSON.stringify(Object.keys(style).sort().reduce((acc, k) => { acc[k] = style[k]; return acc; }, {}));
  for (const [sid, sv] of Object.entries(sheet.styles || {})) {
    if (JSON.stringify(Object.keys(sv).sort().reduce((acc, k) => { acc[k] = sv[k]; return acc; }, {})) === styleKey) return sid;
  }
  const existingIds = Object.keys(sheet.styles || {});
  let maxN = 0;
  for (const sid of existingIds) { const m = /^style_(\d+)$/.exec(sid); if (m) maxN = Math.max(maxN, Number(m[1])); }
  const newId = `style_${String(maxN + 1).padStart(3, '0')}`;
  sheet.styles = sheet.styles || {};
  sheet.styles[newId] = { ...style };
  return newId;
}

// 返回 { seq, targetSheetId, batchUpdates, effectiveCommand, rebaseResult }
async function commitBatchSetCell(normalizedCommand) {
  const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
  if (!currentDoc) throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);

  const otResult = await rebaseBatchSetCellCommand({
    command: normalizedCommand,
    currentDoc,
    historySource: docRealtimeStore,
  });
  const effectiveCommand = otResult.command;
  const rebaseResult = otResult.rebaseResult;

  const currentSnapshot = normalizeDocSnapshot(currentDoc.snapshotJson, { docId: normalizedCommand.docId });
  const currentSheets = currentSnapshot.sheets || {};
  const targetSheetId = effectiveCommand.sheetId in currentSheets
    ? effectiveCommand.sheetId
    : currentSnapshot.activeSheetId;

  if (!currentSheets[targetSheetId]) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${effectiveCommand.sheetId}`, {
      docId: effectiveCommand.docId, sheetId: effectiveCommand.sheetId,
    });
  }

  const nextSnapshot = JSON.parse(JSON.stringify(currentSnapshot));
  const nextSheet = nextSnapshot.sheets[targetSheetId];
  nextSheet.cells = nextSheet.cells || {};

  const batchUpdates = [];
  for (const update of effectiveCommand.updates) {
    const cellKey = `${update.row}:${update.col}`;
    const prevCell = nextSheet.cells[cellKey] || {};
    const oldValue = prevCell.value ?? '';
    const oldStyleId = typeof prevCell.styleId === 'string' ? prevCell.styleId : null;
    const oldStyle = oldStyleId && nextSheet.styles ? (nextSheet.styles[oldStyleId] || null) : null;
    const newValue = update.value ?? (effectiveCommand.value ?? '');
    const newStyle = update.style !== undefined ? update.style : (effectiveCommand.style !== undefined ? effectiveCommand.style : null);
    const nextStyleId = findOrCreateStyleId(nextSheet, newStyle);

    nextSheet.cells[cellKey] = { row: update.row, col: update.col, value: newValue, styleId: nextStyleId };
    if (update.row > nextSheet.rowCount) nextSheet.rowCount = update.row;
    if (update.col > nextSheet.colCount) nextSheet.colCount = update.col;
    batchUpdates.push({ row: update.row, col: update.col, oldValue, oldStyle, newValue, newStyle });
  }

  const event = {
    opType: 'batch_set_cell',
    targetSheetId,
    clientId: normalizedCommand.clientId,
    baseSeq: rebaseResult.baseSeq,
    payloadJson: {
      type: 'batch_set_cell',
      sheetId: targetSheetId,
      patch: {
        ...(effectiveCommand.value !== undefined ? { value: effectiveCommand.value } : {}),
        ...(effectiveCommand.style !== undefined ? { style: effectiveCommand.style } : {}),
      },
      updates: batchUpdates,
    },
  };

  const commitResult = await docsService.commitRealtimeOp(normalizedCommand.docId, {
    expectedBaseSeq: rebaseResult.baseSeq,
    snapshotJson: nextSnapshot,
    event,
  });

  if (!commitResult.ok) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'concurrent modification, please retry', {
      docId: normalizedCommand.docId, currentSeq: commitResult.currentSeq,
    });
  }

  return { seq: commitResult.seq, targetSheetId, batchUpdates, effectiveCommand, rebaseResult };
}

module.exports = { commitBatchSetCell };
