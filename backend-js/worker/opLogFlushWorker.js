const streamConfig = require('../config/streamConfig');
const docStore = require('../store/docStore');
const historyStore = require('../store/historyStore');
const docOpStreamStore = require('../store/redis/docOpStreamStore');
const docFlushProgressStore = require('../store/redis/docFlushProgressStore');
const docRealtimeStore = require('../store/redis/docRealtimeStore');
const docPendingCreateStore = require('../store/redis/docPendingCreateStore');
const { applyReplayEvent, isHistoryDuplicateError } = require('./replayUtils');

async function applyDocStoreOp(docId, event) {
  return applyReplayEvent(docStore, docId, event);
}

async function ensureDocStateApplied(docId, event) {
  const currentDoc = await docStore.getDocState(docId);
  if (!currentDoc) {
    throw new Error(`document not found while flushing stream event: ${docId}`);
  }

  if (currentDoc.currentSeq >= event.seq) {
    return;
  }

  if (currentDoc.currentSeq !== event.seq - 1) {
    throw new Error(
      `document seq mismatch while replaying ${docId}: expected ${event.seq - 1}, got ${currentDoc.currentSeq}`
    );
  }

  await applyDocStoreOp(docId, event);
}

function createOpLogFlushWorker() {
  let running = false;
  let loopPromise = null;

  async function flushPendingCreate(docId) {
    const existingDoc = await docStore.getDocState(docId);
    if (existingDoc) {
      await docPendingCreateStore.removePendingDoc(docId);
      return;
    }

    const [pendingMeta, realtimeState] = await Promise.all([
      docPendingCreateStore.getPendingDocMeta(docId),
      docRealtimeStore.getState(docId),
    ]);

    if (!pendingMeta || !realtimeState) {
      return;
    }

    await docStore.createDoc({
      docId: pendingMeta.docId,
      title: pendingMeta.title,
      createdBy: pendingMeta.createdBy,
      snapshotJson: realtimeState.snapshotJson,
      currentSeq: realtimeState.currentSeq,
      createdAt: pendingMeta.createdAt,
      updatedAt: pendingMeta.updatedAt,
    });

    await docPendingCreateStore.removePendingDoc(docId);
  }

  async function processPendingCreates() {
    const pendingDocIds = await docPendingCreateStore.listPendingDocIds();

    for (const docId of pendingDocIds) {
      if (!running) {
        break;
      }

      try {
        await flushPendingCreate(docId);
      } catch (error) {
        console.error(`opLogFlushWorker pending create ${docId}:`, error);
      }
    }
  }

  async function processEvent(docId, id, event) {
    try {
      try {
        await historyStore.append({
          docId,
          clientId: event.clientId,
          seq: event.seq,
          baseSeq: event.baseSeq,
          opType: event.opType,
          targetSheetId: event.targetSheetId,
          targetRow: event.targetRow,
          targetCol: event.targetCol,
          oldValueJson: event.oldValueJson,
          newValueJson: event.newValueJson,
        payloadJson: event.payloadJson,
        sourceSeq: event.sourceSeq,
        });
      } catch (err) {
        if (isHistoryDuplicateError(err)) {
          await ensureDocStateApplied(docId, event);
          await docFlushProgressStore.setFlushedSeq(docId, event.seq);
          await docOpStreamStore.ack(docId, id);
          return;
        } else {
          throw err;
        }
      }

      await ensureDocStateApplied(docId, event);
      await docFlushProgressStore.setFlushedSeq(docId, event.seq);
      await docOpStreamStore.ack(docId, id);
    } catch (err) {
      console.error(`opLogFlushWorker ${docId} seq=${event.seq}:`, err);
    }
  }

  async function consumeDoc(docId) {
    await docOpStreamStore.ensureGroup(docId);
    const batch = await docOpStreamStore.readBatch(docId, { blockMs: 500 });
    for (const { id, event } of batch) {
      if (!running) break;
      await processEvent(docId, id, event);
    }
  }

  async function loop() {
    while (running) {
      try {
        await processPendingCreates();
        const docs = await docStore.list();
        for (const doc of docs) {
          if (!running) break;
          await consumeDoc(doc.docId);
        }
      } catch (err) {
        console.error('opLogFlushWorker loop error:', err);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return {
    name: 'opLogFlushWorker',
    async start() {
      running = true;
      if (streamConfig.driver === 'redis') {
        loopPromise = loop();
      }
    },
    async stop() {
      running = false;
      if (loopPromise) await loopPromise.catch(() => {});
    },
    isRunning() { return running; },
  };
}

module.exports = {
  createOpLogFlushWorker,
  applyDocStoreOp,
  ensureDocStateApplied,
};
