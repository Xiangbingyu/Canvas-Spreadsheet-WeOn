const docStore = require('../../store/docStore');
const historyStore = require('../../store/historyStore');
const docRealtimeStore = require('../../store/redis/docRealtimeStore');
const { normalizeDocSnapshot } = require('../../domain/entities/doc');

async function seedRealtimeFromMysql(docId) {
  const stored = await docStore.getDocState(docId);
  if (!stored) return null;

  const snapshotJson = normalizeDocSnapshot(stored.snapshotJson, { docId });
  await docRealtimeStore.seed(docId, { snapshotJson, currentSeq: stored.currentSeq });
  return { docId, currentSeq: stored.currentSeq, snapshotJson };
}

async function rebuildRealtime(docId) {
  const stored = await docStore.getDocState(docId);
  if (!stored) return null;

  const checkpoint = await docRealtimeStore.getCheckpoint(docId) || 0;
  const maxSeq = Math.max(checkpoint, stored.currentSeq);

  if (maxSeq > checkpoint) {
    const missingOps = await historyStore.listByDocIdSeqRange(docId, checkpoint, maxSeq);
    for (const op of missingOps) {
      const cmd = { ...op, docId, seq: op.seq };
      switch (op.opType) {
        case 'set_cell': await docStore.applySetCell(cmd); break;
        case 'set_title': await docStore.applySetTitle(cmd); break;
        case 'add_sheet': await docStore.applyAddSheet(cmd); break;
        case 'import_sheet': await docStore.applyImportSheet(cmd); break;
        case 'insert_row':
        case 'delete_row':
        case 'insert_col':
        case 'delete_col': await docStore.applySheetStructureChange(cmd); break;
        default: break;
      }
    }
  }

  const final = await docStore.getDocState(docId);
  const snapshotJson = normalizeDocSnapshot(final.snapshotJson, { docId });
  await docRealtimeStore.seed(docId, { snapshotJson, currentSeq: final.currentSeq });
  return { docId, currentSeq: final.currentSeq, snapshotJson };
}

module.exports = { seedRealtimeFromMysql, rebuildRealtime };
