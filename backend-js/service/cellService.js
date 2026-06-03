const { ERROR_CODES } = require('../protocol/errorCodes');
const storeConfig = require('../config/storeConfig');
const { withTransaction } = require('../db/mysql');
const docLock = require('../infra/redis/lock');
const docsService = require('./docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const auditService = require('../audit/auditService');
const collabConfig = require('../config/collabConfig');
const { normalizeBaseSeq, rebaseSetCellCommand } = require('./cellOtService');
const docStateCache = require('../cache/docStateCache');
const historyCache = require('../cache/historyCache');
const asyncWriteQueue = require('../infra/asyncWriteQueue');
const { deepClone } = require('../utils/clone');
const { normalizeDocSnapshot } = require('../domain/entities/doc');

// historyStore wrapper: hit memory cache first, fall back to DB
const historyCacheAwareStore = {
  ...historyStore,
  async listByDocIdSeqRange(docId, start, end, opts) {
    const cached = historyCache.listByDocIdSeqRange(docId, start, end);
    if (cached !== null) return cached;
    return historyStore.listByDocIdSeqRange(docId, start, end, opts);
  },
};

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function findOrCreateStyleId(sheet, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return null;
  const key = stableStringify(style);
  for (const [id, val] of Object.entries(sheet.styles || {})) {
    if (stableStringify(val) === key) return id;
  }
  const existingIds = Object.keys(sheet.styles || {});
  let max = 0;
  for (const id of existingIds) {
    const m = /^style_(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const newId = `style_${String(max + 1).padStart(3, '0')}`;
  sheet.styles[newId] = deepClone(style);
  return newId;
}

// Pure in-memory apply — mirrors docMysqlStore.applySetCell logic without SQL
function applySetCellToRecord(currentDoc, command) {
  const nextSnapshot = normalizeDocSnapshot(deepClone(currentDoc.snapshotJson), { docId: command.docId });
  const sheetId = command.sheetId || nextSnapshot.activeSheetId;
  const sheet = nextSnapshot.sheets && nextSnapshot.sheets[sheetId];
  if (!sheet) return null;

  const cellKey = `${command.row}:${command.col}`;
  const prev = sheet.cells[cellKey] || {};
  const oldValue = prev.value ?? '';
  const oldStyleId = typeof prev.styleId === 'string' ? prev.styleId : null;
  const oldStyle = oldStyleId ? deepClone(sheet.styles[oldStyleId] || null) : null;
  const newStyleId = command.style !== undefined ? findOrCreateStyleId(sheet, command.style) : null;

  sheet.cells[cellKey] = { row: command.row, col: command.col, value: command.value ?? '', styleId: newStyleId };
  if (command.row > sheet.rowCount) sheet.rowCount = command.row;
  if (command.col > sheet.colCount) sheet.colCount = command.col;

  const updatedRecord = { ...currentDoc, snapshotJson: nextSnapshot };
  return { updatedRecord, targetSheetId: sheetId, oldValue, oldStyle };
}

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isValidCellPosition(value) {
  return Number.isInteger(value) && value >= 1;
}

function normalizeSetCellCommand(command = {}) {
  const { docId, clientId, sheetId, row, col, value, style } = command;

  if (
    typeof docId !== 'string'
    || !docId.trim()
    || typeof clientId !== 'string'
    || !clientId.trim()
    || typeof sheetId !== 'string'
    || !sheetId.trim()
    || !isValidCellPosition(row)
    || !isValidCellPosition(col)
  ) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId, clientId, sheetId, row and col are required');
  }

  return {
    docId: docId.trim(),
    clientId: clientId.trim(),
    sheetId: sheetId.trim(),
    row,
    col,
    value: value ?? '',
    style: style !== undefined ? style : null,
    baseSeq: normalizeBaseSeq(command.baseSeq),
  };
}

function trimUndoStack(entries) {
  const limit = Number.isInteger(collabConfig.userOpStackLimit) && collabConfig.userOpStackLimit > 0
    ? collabConfig.userOpStackLimit
    : 100;
  return entries.length <= limit ? entries : entries.slice(entries.length - limit);
}

async function applySetCell(command = {}) {
  const normalizedCommand = normalizeSetCellCommand(command);

  return docLock.withDocLock(normalizedCommand.docId, async () => {
    let seq = 0;
    let trimmedUndoStack = [];
    let effectiveCommand = normalizedCommand;
    let rebaseResult = { enabled: false, rebased: false, baseSeq: null, conflictSeq: null };
    let targetSheetId;
    let oldValue;
    let oldStyle;
    let updatedRecord;

    if (storeConfig.driver === 'mysql') {
      // --- mysql fast path: all reads/writes in memory, MySQL async ---
      let currentDoc = docStateCache.get(normalizedCommand.docId);
      if (!currentDoc) {
        currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
        if (!currentDoc) throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        docStateCache.set(normalizedCommand.docId, currentDoc);
      }

      const otResult = await rebaseSetCellCommand({
        command: normalizedCommand,
        currentDoc,
        historyStore: historyCacheAwareStore,
      });
      effectiveCommand = otResult.command;
      rebaseResult = otResult.rebaseResult;

      const currentSheets = (currentDoc.snapshotJson || {}).sheets || {};
      if (!currentSheets[effectiveCommand.sheetId]) {
        throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${effectiveCommand.sheetId}`, {
          docId: effectiveCommand.docId, sheetId: effectiveCommand.sheetId,
        });
      }

      const applied = applySetCellToRecord(currentDoc, effectiveCommand);
      if (!applied) throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
      ({ updatedRecord, targetSheetId, oldValue, oldStyle } = applied);

      seq = currentDoc.currentSeq + 1;
      updatedRecord.currentSeq = seq;

      const historyEntry = {
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        seq,
        baseSeq: rebaseResult.baseSeq,
        opType: 'set_cell',
        targetSheetId,
        targetRow: effectiveCommand.row,
        targetCol: effectiveCommand.col,
        oldValueJson: { value: oldValue, style: oldStyle },
        newValueJson: { value: effectiveCommand.value, style: effectiveCommand.style },
        createdAt: new Date().toISOString(),
      };

      // undo stack — still sync (lightweight, no snapshot)
      const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId);
      const undoStack = opState ? [...opState.undoStackJson] : [];
      undoStack.push({
        sourceSeq: seq,
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        opType: 'set_cell',
        sheetId: targetSheetId,
        row: effectiveCommand.row,
        col: effectiveCommand.col,
        oldValue,
        oldStyle,
        newValue: effectiveCommand.value,
        newStyle: effectiveCommand.style,
        baseSeq: rebaseResult.baseSeq,
      });
      trimmedUndoStack = trimUndoStack(undoStack);
      await userOpStateStore.saveState({
        docId: normalizedCommand.docId,
        clientId: normalizedCommand.clientId,
        undoStackJson: trimmedUndoStack,
        redoStackJson: [],
      });

      // Commit the live in-memory state only after the sync user-op-state write succeeds.
      docStateCache.set(normalizedCommand.docId, updatedRecord);
      historyCache.append(historyEntry);
      asyncWriteQueue.enqueue({
        type: 'applySetCell',
        data: { docId: normalizedCommand.docId, snapshotJson: updatedRecord.snapshotJson, seq, updatedAt: historyEntry.createdAt },
      });
      asyncWriteQueue.enqueue({ type: 'appendHistory', data: historyEntry });
      await docsService.invalidateDocCaches(normalizedCommand.docId);
    } else {
      // --- memory store path: unchanged ---
      let currentDocForMemory = null;
      const executeMutation = async (connection = null) => {
        currentDocForMemory = await docsService.getDocStateForWrite(normalizedCommand.docId, {
          connection,
          forUpdate: Boolean(connection),
        });

        if (!currentDocForMemory) {
          throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
        }

        const otResult = await rebaseSetCellCommand({
          command: normalizedCommand,
          currentDoc: currentDocForMemory,
          historyStore,
          connection,
        });
        effectiveCommand = otResult.command;
        rebaseResult = otResult.rebaseResult;

        const currentSheets = (currentDocForMemory.snapshotJson || {}).sheets || {};
        if (!currentSheets[effectiveCommand.sheetId]) {
          throw createServiceError(ERROR_CODES.INVALID_PARAMS, `sheet not found: ${effectiveCommand.sheetId}`, {
            docId: effectiveCommand.docId, sheetId: effectiveCommand.sheetId,
          });
        }

        updatedRecord = await docsService.applySetCell({ ...effectiveCommand }, { connection });
        if (!updatedRecord) throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);

        seq = updatedRecord.currentSeq;
        targetSheetId = updatedRecord._targetSheetId;
        ({ value: oldValue, style: oldStyle } = updatedRecord._before);

        await historyStore.append({
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          seq,
          baseSeq: rebaseResult.baseSeq,
          opType: 'set_cell',
          targetSheetId,
          targetRow: effectiveCommand.row,
          targetCol: effectiveCommand.col,
          oldValueJson: { value: oldValue, style: oldStyle },
          newValueJson: { value: effectiveCommand.value, style: effectiveCommand.style },
        }, { connection });

        const opState = await userOpStateStore.getState(normalizedCommand.docId, normalizedCommand.clientId, { connection });
        const undoStack = opState ? [...opState.undoStackJson] : [];
        undoStack.push({
          sourceSeq: seq,
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          opType: 'set_cell',
          sheetId: targetSheetId,
          row: effectiveCommand.row,
          col: effectiveCommand.col,
          oldValue,
          oldStyle,
          newValue: effectiveCommand.value,
          newStyle: effectiveCommand.style,
          baseSeq: rebaseResult.baseSeq,
        });
        trimmedUndoStack = trimUndoStack(undoStack);
        await userOpStateStore.saveState({
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          undoStackJson: trimmedUndoStack,
          redoStackJson: [],
        }, { connection });
      };

      await executeMutation();
      await docsService.invalidateDocCaches(normalizedCommand.docId);
    }

    await auditService.recordAuditEvent({
      type: 'set_cell',
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      seq,
    });

    return {
      docId: normalizedCommand.docId,
      clientId: normalizedCommand.clientId,
      sheetId: targetSheetId || effectiveCommand.sheetId,
      seq,
      row: effectiveCommand.row,
      col: effectiveCommand.col,
      value: effectiveCommand.value,
      style: effectiveCommand.style,
      canUndo: true,
      canRedo: false,
    };
  });
}

module.exports = {
  applySetCell,
};
