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
const docSnapshotCache = require('../cache/docSnapshotCache');
const cacheStore = require('../cache/cacheStore');
const cacheConfig = require('../config/cacheConfig');
const { docSeqKey, docSnapshotKey, histEntryKey } = require('../cache/cacheKeys');
const asyncWriteQueue = require('../infra/asyncWriteQueue');
const { commitSetCellAtomically } = require('../infra/redis/setCellAtomicCommit');
const { deepClone } = require('../utils/clone');
const { normalizeDocSnapshot } = require('../domain/entities/doc');

const ATOMIC_SET_CELL_RETRY_LIMIT = 1;

// historyStore wrapper: hit cache first, fall back to DB
const historyCacheAwareStore = {
  ...historyStore,
  async listByDocIdSeqRange(docId, start, end, opts) {
    const cached = await historyCache.listByDocIdSeqRange(docId, start, end);
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

function isSeqMismatchError(error) {
  return String(error?.message || '').includes('SEQ_MISMATCH');
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

function toCachedDocView(docRecord) {
  return {
    docId: docRecord.docId,
    title: docRecord.title,
    currentSeq: docRecord.currentSeq,
    createdBy: docRecord.createdBy,
    createdAt: docRecord.createdAt,
    updatedAt: docRecord.updatedAt || new Date().toISOString(),
    snapshot: docRecord.snapshotJson,
  };
}

async function writeLiveDocState(docRecord, historyEntry = null) {
  const entries = [
    {
      key: docSeqKey(docRecord.docId),
      value: { currentSeq: docRecord.currentSeq },
    },
    {
      key: docSnapshotKey(docRecord.docId),
      value: toCachedDocView(docRecord),
      ttlMs: cacheConfig.docSnapshotTtlMs,
    },
  ];

  if (historyEntry) {
    entries.push({
      key: histEntryKey(historyEntry.docId, historyEntry.seq),
      value: historyEntry,
      ttlMs: cacheConfig.historyTtlMs,
    });
  }

  await cacheStore.setMany(entries);
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
      // --- mysql fast path: reads from cache, MySQL async ---
      const docId = normalizedCommand.docId;
      const canUseAtomicRedisCommit = cacheConfig.driver === 'redis'
        && userOpStateStore.type === 'mysql+redis';
      const maxAttempts = canUseAtomicRedisCommit ? (ATOMIC_SET_CELL_RETRY_LIMIT + 1) : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        // Read seq and snapshot separately (both backed by cacheStore → Redis or memory)
        let [seqData, docView] = await Promise.all([
          docStateCache.get(docId),
          docSnapshotCache.get(docId),
        ]);

        if (!seqData || !docView) {
          const dbDoc = await docsService.getDocStateForWrite(docId);
          if (!dbDoc) throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${docId}`);
          await writeLiveDocState({
            ...dbDoc,
            snapshotJson: normalizeDocSnapshot(dbDoc.snapshotJson, { docId }),
          });
          [seqData, docView] = await Promise.all([
            docStateCache.get(docId),
            docSnapshotCache.get(docId),
          ]);
        }

        // Compose currentDoc from the two cache entries
        const currentDoc = {
          docId: docView.docId,
          title: docView.title,
          currentSeq: seqData.currentSeq,
          createdBy: docView.createdBy,
          createdAt: docView.createdAt,
          updatedAt: docView.updatedAt,
          snapshotJson: docView.snapshot,
        };

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
        const nextUserOpState = {
          docId: normalizedCommand.docId,
          clientId: normalizedCommand.clientId,
          undoStackJson: trimmedUndoStack,
          redoStackJson: [],
        };
        const persistMessage = {
          type: 'persistSetCell',
          data: {
            docId: normalizedCommand.docId,
            snapshotJson: updatedRecord.snapshotJson,
            seq,
            updatedAt: historyEntry.createdAt,
            historyEntry,
            userOpState: nextUserOpState,
          },
        };

        if (canUseAtomicRedisCommit) {
          try {
            await commitSetCellAtomically({
              expectedSeq: currentDoc.currentSeq,
              updatedRecord,
              historyEntry,
              userOpState: nextUserOpState,
              persistMessage,
            });
            break;
          } catch (error) {
            if (isSeqMismatchError(error) && attempt < maxAttempts) {
              console.warn('[cellService] set_cell atomic commit seq mismatch, retrying once', {
                docId: normalizedCommand.docId,
                expectedSeq: currentDoc.currentSeq,
                attempt,
              });
              continue;
            }

            if (isSeqMismatchError(error)) {
              throw createServiceError(ERROR_CODES.CONFLICT, 'set_cell live state sequence mismatch', {
                docId: normalizedCommand.docId,
                expectedSeq: currentDoc.currentSeq,
                attempts: attempt,
              });
            }

            throw error;
          }
        } else {
          await userOpStateStore.saveState(nextUserOpState);
          await writeLiveDocState(updatedRecord, historyEntry);
          await asyncWriteQueue.enqueue(persistMessage);
          break;
        }
      }
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
