const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { normalizeBaseSeq, rebaseBatchSetCellCommand } = require('./cellOtService');
const docStateCache = require('../cache/docStateCache');
const historyCache = require('../cache/historyCache');
const asyncWriteQueue = require('../infra/asyncWriteQueue');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isValidCellPosition(value) {
  return Number.isInteger(value) && value >= 1;
}

function trimStack(entries) {
  const limit = Number.isInteger(collabConfig.userOpStackLimit) && collabConfig.userOpStackLimit > 0
    ? collabConfig.userOpStackLimit
    : 100;
  return entries.length <= limit ? entries : entries.slice(entries.length - limit);
}

function collectReferencedStyles(updates = [], styles = {}) {
  const referenced = {};

  for (const update of updates) {
    for (const styleId of [update.oldStyleId, update.newStyleId]) {
      if (typeof styleId === 'string' && styles[styleId] !== undefined) {
        referenced[styleId] = JSON.parse(JSON.stringify(styles[styleId]));
      }
    }
  }

  return referenced;
}

function normalizeSetRangeValuesCommand(command = {}) {
  const { docId, clientId, sheetId, styles, cells } = command;

  if (
    typeof docId !== 'string' || !docId.trim()
    || typeof clientId !== 'string' || !clientId.trim()
    || typeof sheetId !== 'string' || !sheetId.trim()
  ) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, sheetId and non-empty cells are required');
  }

  if (!Array.isArray(cells) || cells.length === 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, sheetId and non-empty cells are required');
  }

  const normalizedStyles = (styles && typeof styles === 'object' && !Array.isArray(styles)) ? styles : {};

  const normalizedCells = cells.map((cell, idx) => {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, `cells[${idx}] must be an object`);
    }

    if (!isValidCellPosition(cell.row) || !isValidCellPosition(cell.col)) {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, `cells[${idx}]: row and col must be positive integers`);
    }

    const hasValue = 'value' in cell;
    const hasStyleId = 'styleId' in cell;

    if (!hasValue && !hasStyleId) {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'each cell patch requires value or styleId');
    }

    if (hasStyleId && typeof cell.styleId === 'string') {
      const inPool = normalizedStyles[cell.styleId] !== undefined;
      if (!inPool) {
        // will be validated against doc styles in the mutation; just flag unknown pool refs
        // that are also not in the doc — deferred to store layer
      }
    }

    return {
      row: cell.row,
      col: cell.col,
      ...(hasValue ? { value: cell.value } : {}),
      ...('styleId' in cell ? { styleId: cell.styleId } : {}),
    };
  });

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    sheetId: sheetId.trim(),
    baseSeq: normalizeBaseSeq(command.baseSeq),
    styles: normalizedStyles,
    cells: normalizedCells,
  };
}

function toRangeUndoEntry({ sourceSeq, docId, clientId, sheetId, baseSeq, appliedCells, styles }) {
  return {
    sourceSeq,
    docId,
    clientId,
    opType: 'set_range_values',
    sheetId,
    baseSeq,
    styles: JSON.parse(JSON.stringify(styles)),
    updates: JSON.parse(JSON.stringify(appliedCells)),
  };
}

async function applySetRangeValues(command = {}) {
  const normalizedCommand = normalizeSetRangeValuesCommand(command);

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let updatedDoc = null;
    let seq = 0;
    let trimmedUndoStack = [];
    let nextOpState = null;
    let effectiveCommand = normalizedCommand;
    let finalCells = [];
    let targetSheetId = normalizedCommand.sheetId;

    if (storeConfig.driver === 'mysql') {
      await asyncWriteQueue.drain();
    }

    const executeMutation = async (connection = null) => {
      const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId, {
        connection,
        forUpdate: Boolean(connection),
      });

      if (!currentDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      // rebase uses same OT logic as batch_set_cell (per-cell coordinate transform)
      const otResult = await rebaseBatchSetCellCommand({
        command: { ...normalizedCommand, updates: normalizedCommand.cells },
        currentDoc,
        historyStore,
        connection,
      });

      effectiveCommand = {
        ...normalizedCommand,
        baseSeq: otResult.command.baseSeq,
        cells: otResult.command.updates,
      };

      const currentSnapshot = currentDoc.snapshotJson || {};
      const currentSheets = currentSnapshot.sheets || {};

      if (!currentSheets[effectiveCommand.sheetId]) {
        throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${effectiveCommand.sheetId}`, {
          docId: effectiveCommand.docId,
          sheetId: effectiveCommand.sheetId,
        });
      }

      updatedDoc = await docsService.applyRangeValues({
        docId: effectiveCommand.docId,
        sheetId: effectiveCommand.sheetId,
        styles: effectiveCommand.styles,
        cells: effectiveCommand.cells,
      }, { connection });

      if (!updatedDoc) {
        throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      }

      seq = updatedDoc.currentSeq;
      targetSheetId = updatedDoc._targetSheetId || effectiveCommand.sheetId;
      finalCells = updatedDoc._rangeUpdates || [];

      await historyStore.append({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        seq,
        baseSeq: otResult.rebaseResult.baseSeq,
        opType: 'set_range_values',
        targetSheetId,
        payloadJson: {
          type: 'set_range_values',
          sheetId: targetSheetId,
          styles: effectiveCommand.styles,
          updates: finalCells,
        },
      }, { connection });

      const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId, { connection });
      const undoStack = opState ? [...opState.undoStackJson] : [];
      undoStack.push(toRangeUndoEntry({
        sourceSeq: seq,
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        sheetId: targetSheetId,
        baseSeq: otResult.rebaseResult.baseSeq,
        appliedCells: finalCells,
        styles: collectReferencedStyles(finalCells, updatedDoc._rangeStyles || {}),
      }));
      trimmedUndoStack = trimStack(undoStack);

      nextOpState = {
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: trimmedUndoStack,
        redoStackJson: [],
      };
      await userOpStateStore.saveState(nextOpState, { connection });
    };

    if (storeConfig.driver === 'mysql') {
      await withTransaction(async (connection) => executeMutation(connection));
    } else {
      await executeMutation();
    }

    if (nextOpState && typeof userOpStateStore.syncRuntimeState === 'function') {
      await userOpStateStore.syncRuntimeState(nextOpState);
    }

    await Promise.all([
      docStateCache.set(normalizedCommand.docId, updatedDoc),
      historyCache.append({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        seq,
        baseSeq: effectiveCommand.baseSeq,
        opType: 'set_range_values',
        targetSheetId,
      }),
    ]);
    await docsService.invalidateDocCaches(normalizedCommand.docId);

    await auditService.recordAuditEvent({
      type: 'set_range_values',
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
      sheetId: targetSheetId,
      updates: finalCells,
    });

    const broadcastStyles = {};
    for (const cell of finalCells) {
      if (typeof cell.newStyleId === 'string' && updatedDoc._rangeStyles && updatedDoc._rangeStyles[cell.newStyleId]) {
        broadcastStyles[cell.newStyleId] = updatedDoc._rangeStyles[cell.newStyleId];
      }
    }

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: targetSheetId,
      seq,
      styles: broadcastStyles,
      cells: finalCells.map((u) => ({
        row: u.row,
        col: u.col,
        value: u.newValue,
        styleId: u.newStyleId !== undefined ? u.newStyleId : null,
      })),
      canUndo: true,
      canRedo: false,
    };
  });
}

module.exports = { applySetRangeValues };
