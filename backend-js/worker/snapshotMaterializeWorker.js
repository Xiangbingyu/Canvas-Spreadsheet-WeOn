const workerConfig = require('../config/workerConfig');
const streamConfig = require('../config/streamConfig');
const docStore = require('../store/docStore');
const docOpStreamStore = require('../store/redis/docOpStreamStore');
const docRealtimeStore = require('../store/redis/docRealtimeStore');
const docFlushProgressStore = require('../store/redis/docFlushProgressStore');
const { createRealtimeClient } = require('../infra/redis/realtimeClient');
const { createRealtimeKeys } = require('../infra/redis/realtimeKeys');
const { computeNextCheckpoint } = require('./replayUtils');

const connection = createRealtimeClient('snapshot-materialize');
const keys = createRealtimeKeys();

function createSnapshotMaterializeWorker() {
  let running = false;
  let loopPromise = null;
  const lastMaterializedSeqByDoc = new Map();
  const lastSnapshotTimeByDoc = new Map();

  async function materializeDoc(doc) {
    const docId = doc.docId;
    if (!lastMaterializedSeqByDoc.has(docId)) {
      const checkpoint = await docRealtimeStore.getCheckpoint(docId);
      lastMaterializedSeqByDoc.set(
        docId,
        Number.isInteger(checkpoint) ? checkpoint : (Number.isInteger(doc.currentSeq) ? doc.currentSeq : 0)
      );
    }

    const flushedSeq = await docFlushProgressStore.getFlushedSeq(docId);
    const lastMaterializedSeq = lastMaterializedSeqByDoc.get(docId) || 0;
    const pendingOps = Number.isInteger(flushedSeq) ? flushedSeq - lastMaterializedSeq : 0;
    const lastTime = lastSnapshotTimeByDoc.get(docId) || 0;
    const now = Date.now();
    const shouldMaterialize = pendingOps >= workerConfig.snapshotOpInterval
      || (pendingOps > 0 && (now - lastTime) >= workerConfig.snapshotTimeWindowMs);

    if (!shouldMaterialize) return;

    const state = await docRealtimeStore.getState(docId);
    if (!state) return;
    if (state.currentSeq !== flushedSeq) return;

    const client = await connection.ensureReady();
    const updatedAt = new Date().toISOString();
    await docStore.updateSnapshot(docId, state.snapshotJson, state.currentSeq, updatedAt);

    if (client) {
      const currentCheckpoint = await docRealtimeStore.getCheckpoint(docId);
      const nextCheckpoint = computeNextCheckpoint(currentCheckpoint, state.currentSeq, streamConfig.retainCount);
      await client.set(keys.checkpointKey(docId), String(nextCheckpoint));
    }

    await docOpStreamStore.trim(docId);
    lastMaterializedSeqByDoc.set(docId, flushedSeq);
    lastSnapshotTimeByDoc.set(docId, now);
  }

  async function loop() {
    while (running) {
      try {
        const docs = await docStore.list();
        for (const doc of docs) {
          if (!running) break;
          await materializeDoc(doc);
        }
      } catch (err) {
        console.error('snapshotMaterializeWorker loop error:', err);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return {
    name: 'snapshotMaterializeWorker',
    async start() {
      running = true;
      if (streamConfig.driver === 'redis') {
        loopPromise = loop();
      }
    },
    async stop() {
      running = false;
      if (loopPromise) await loopPromise.catch(() => {});
      await connection.close().catch(() => {});
    },
    isRunning() { return running; },
  };
}

module.exports = { createSnapshotMaterializeWorker };
