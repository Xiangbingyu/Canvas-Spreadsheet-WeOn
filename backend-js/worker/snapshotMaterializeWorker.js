const workerConfig = require('../config/workerConfig');
const streamConfig = require('../config/streamConfig');
const docStore = require('../store/docStore');
const docOpStreamStore = require('../store/redis/docOpStreamStore');
const docRealtimeStore = require('../store/redis/docRealtimeStore');
const { createRealtimeClient } = require('../infra/redis/realtimeClient');
const { createRealtimeKeys } = require('../infra/redis/realtimeKeys');

const connection = createRealtimeClient('snapshot-materialize');
const keys = createRealtimeKeys();

function createSnapshotMaterializeWorker() {
  let running = false;
  let loopPromise = null;
  const opCountByDoc = new Map();
  const lastSnapshotTimeByDoc = new Map();

  async function materializeDoc(docId) {
    const opCount = opCountByDoc.get(docId) || 0;
    const lastTime = lastSnapshotTimeByDoc.get(docId) || 0;
    const now = Date.now();
    const shouldMaterialize = opCount >= workerConfig.snapshotOpInterval
      || (opCount > 0 && (now - lastTime) >= workerConfig.snapshotTimeWindowMs);

    if (!shouldMaterialize) return;

    const state = await docRealtimeStore.getState(docId);
    if (!state) return;

    const client = await connection.ensureReady();
    const updatedAt = new Date().toISOString();
    await docStore.updateSnapshot(docId, state.snapshotJson, state.currentSeq, updatedAt);

    if (client) {
      await client.set(keys.checkpointKey(docId), String(state.currentSeq));
    }

    await docOpStreamStore.trim(docId);
    opCountByDoc.set(docId, 0);
    lastSnapshotTimeByDoc.set(docId, now);
  }

  async function loop() {
    while (running) {
      try {
        const docs = await docStore.list();
        for (const doc of docs) {
          if (!running) break;
          const prev = opCountByDoc.get(doc.docId) || 0;
          opCountByDoc.set(doc.docId, prev + 1);
          await materializeDoc(doc.docId);
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
