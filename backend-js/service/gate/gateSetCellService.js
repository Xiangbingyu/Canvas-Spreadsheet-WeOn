const { ERROR_CODES } = require('../../protocol/errorCodes');
const { normalizeDocSnapshot } = require('../../domain/entities/doc');
const docRealtimeStore = require('../../store/redis/docRealtimeStore');
const docsService = require('../docsService');
const { rebaseSetCellCommand } = require('../cellOtService');

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
    if (JSON.stringify(Object.keys(sv).sort().reduce((acc, k) => { acc[k] = sv[k]; return acc; }, {})) === styleKey) {
      return sid;
    }
  }
  const existingIds = Object.keys(sheet.styles || {});
  let maxN = 0;
  for (const sid of existingIds) {
    const m = /^style_(\d+)$/.exec(sid);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  const newId = `style_${String(maxN + 1).padStart(3, '0')}`;
  sheet.styles = sheet.styles || {};
  sheet.styles[newId] = { ...style };
  return newId;
}

// Gate 路径：读 Redis 状态 → OT rebase → 计算 nextSnapshot → Lua 原子提交。
// 返回 { seq, targetSheetId, oldValue, oldStyle, effectiveCommand, rebaseResult }
async function commitSetCell(normalizedCommand) {
  const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
  if (!currentDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const otResult = await rebaseSetCellCommand({
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

  const targetSheet = currentSheets[targetSheetId];
  const cellKey = `${effectiveCommand.row}:${effectiveCommand.col}`;
  const prevCell = (targetSheet.cells && targetSheet.cells[cellKey]) || {};
  const oldValue = prevCell.value ?? '';
  const oldStyleId = typeof prevCell.styleId === 'string' ? prevCell.styleId : null;
  const oldStyle = oldStyleId && targetSheet.styles ? (targetSheet.styles[oldStyleId] || null) : null;

  const nextSnapshot = JSON.parse(JSON.stringify(currentSnapshot));
  const nextSheet = nextSnapshot.sheets[targetSheetId];
  nextSheet.cells = nextSheet.cells || {};
  const nextStyleId = findOrCreateStyleId(nextSheet, effectiveCommand.style);

  nextSheet.cells[cellKey] = {
    row: effectiveCommand.row, col: effectiveCommand.col,
    value: effectiveCommand.value ?? '',
    styleId: nextStyleId,
  };
  if (effectiveCommand.row > nextSheet.rowCount) nextSheet.rowCount = effectiveCommand.row;
  if (effectiveCommand.col > nextSheet.colCount) nextSheet.colCount = effectiveCommand.col;

  const event = {
    opType: 'set_cell',
    targetSheetId,
    targetRow: effectiveCommand.row,
    targetCol: effectiveCommand.col,
    oldValueJson: { value: oldValue, style: oldStyle },
    newValueJson: { value: effectiveCommand.value, style: effectiveCommand.style },
    clientId: normalizedCommand.clientId,
    baseSeq: rebaseResult.baseSeq,
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

  return { seq: commitResult.seq, targetSheetId, oldValue, oldStyle, effectiveCommand, rebaseResult };
}

module.exports = { commitSetCell };
