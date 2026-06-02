const streamConfig = require('../config/streamConfig');
const docStore = require('../store/docStore');
const historyStore = require('../store/historyStore');
const docOpStreamStore = require('../store/redis/docOpStreamStore');

async function applyDocStoreOp(docId, event) {
  const cmd = { ...event, docId, seq: event.seq };
  switch (event.opType) {
    case 'set_cell': return docStore.applySetCell(cmd);
    case 'batch_set_cell': return docStore.applyBatchSetCell(cmd);
    case 'set_title': return docStore.applySetTitle(cmd);
    case 'add_sheet': return docStore.applyAddSheet(cmd);
    case 'import_sheet': return docStore.applyImportSheet(cmd);
    case 'insert_row':
    case 'delete_row':
    case 'insert_col':
    case 'delete_col': return docStore.applySheetStructureChange(cmd);
    default: break;
  }
}

function createOpLogFlushWorker() {
  let running = false;
  let loopPromise = null;

  async function processEvent(docId, id, event) {
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
      });
      await applyDocStoreOp(docId, event);
      await docOpStreamStore.ack(docId, id);
    } catch (err) {
      const msg = String(err && (err.code || err.message));
      if (msg.includes('DUPLICATE')) {
        await docOpStreamStore.ack(docId, id);
      } else {
        console.error(`opLogFlushWorker ${docId} seq=${event.seq}:`, err);
      }
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

module.exports = { createOpLogFlushWorker };
