const docStore = require('../../store/docStore');
const historyStore = require('../../store/historyStore');
const docRealtimeStore = require('../../store/redis/docRealtimeStore');
const { normalizeDocSnapshot } = require('../../domain/entities/doc');
const { applyReplayEvent } = require('../../worker/replayUtils');
const createDocMemoryStore = require('../../store/memory/docMemoryStore');

async function seedRealtimeFromMysql(docId) {
  const stored = await docStore.getDocState(docId);
  if (!stored) return null;

  const snapshotJson = normalizeDocSnapshot(stored.snapshotJson, { docId });
  await docRealtimeStore.seed(docId, {
    snapshotJson,
    currentSeq: stored.currentSeq,
    updatedAt: stored.updatedAt,
  });
  return { docId, currentSeq: stored.currentSeq, snapshotJson };
}

async function rebuildRealtime(docId) {
  const stored = await docStore.getDocState(docId);
  if (!stored) return null;

  const tempStore = createDocMemoryStore();
  tempStore.seedSync([{
    docId,
    title: stored.title,
    createdBy: stored.createdBy,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    currentSeq: stored.currentSeq,
    snapshotJson: normalizeDocSnapshot(stored.snapshotJson, { docId }),
  }]);

  const missingOps = await historyStore.listByDocIdSeqRange(docId, stored.currentSeq, Number.MAX_SAFE_INTEGER);
  for (const op of missingOps) {
    await applyReplayEvent(tempStore, docId, op);
  }

  const final = await tempStore.getDocState(docId);
  const snapshotJson = normalizeDocSnapshot(final.snapshotJson, { docId });
  await docRealtimeStore.seed(docId, {
    snapshotJson,
    currentSeq: final.currentSeq,
    updatedAt: final.updatedAt || stored.updatedAt,
  });
  return { docId, currentSeq: final.currentSeq, snapshotJson };
}

module.exports = { seedRealtimeFromMysql, rebuildRealtime };
