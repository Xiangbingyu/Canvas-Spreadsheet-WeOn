const assert = require('node:assert/strict');
const test = require('node:test');

const createDocRealtimeRedisStore = require('../store/redis/docRealtimeRedisStore');
const { createDoc } = require('../domain/entities/doc');
const { createUserOpState } = require('../domain/entities/userOpState');
const { createRedisConnection } = require('../infra/redis/client');

async function resetRedisKeys(prefix = 'collab:runtime:doc_realtime*') {
  const client = createRedisConnection('doc-realtime-test-reset');

  try {
    await client.connect();

    for await (const keys of client.scanIterator({ MATCH: prefix, COUNT: 100 })) {
      if (keys.length > 0) {
        await client.del(keys);
      }
    }
  } finally {
    if (client.isOpen) {
      await client.quit().catch(() => client.disconnect());
    }
  }
}

test.beforeEach(async () => {
  await resetRedisKeys();
});

test('doc realtime redis store loads persistent doc lazily and keeps seq barrier and stream state in redis', async () => {
  const persistentDocs = new Map([
    ['doc_realtime_001', createDoc({
      docId: 'doc_realtime_001',
      title: 'Realtime Doc',
      currentSeq: 7,
      snapshotJson: {
        activeSheetId: 'sheet_doc_realtime_001_001',
        sheetOrder: ['sheet_doc_realtime_001_001'],
        sheets: {
          sheet_doc_realtime_001_001: {
            id: 'sheet_doc_realtime_001_001',
            name: 'Sheet1',
            defaultRowHeight: 25,
            defaultColWidth: 100,
            rowCount: 1,
            colCount: 1,
            styles: {},
            cells: {
              '1:1': {
                row: 1,
                col: 1,
                value: 'seed',
                styleId: null,
              },
            },
          },
        },
      },
    })],
  ]);
  const persistentCheckpoints = new Map([
    ['doc_realtime_001', {
      docId: 'doc_realtime_001',
      checkpointSeq: 7,
      title: 'Checkpoint Doc',
      snapshotJson: {
        activeSheetId: 'sheet_doc_realtime_001_001',
        sheetOrder: ['sheet_doc_realtime_001_001'],
        sheets: {
          sheet_doc_realtime_001_001: {
            id: 'sheet_doc_realtime_001_001',
            name: 'Sheet1',
            defaultRowHeight: 25,
            defaultColWidth: 100,
            rowCount: 1,
            colCount: 1,
            styles: {},
            cells: {
              '1:1': {
                row: 1,
                col: 1,
                value: 'checkpoint-seed',
                styleId: null,
              },
            },
          },
        },
      },
      updatedAt: new Date().toISOString(),
    }],
  ]);
  const persistentBarriers = new Map([
    ['doc_realtime_001', {
      docId: 'doc_realtime_001',
      seq: 7,
      opType: 'import_sheet',
      eventId: 'evt_checkpoint_barrier',
      updatedAt: new Date().toISOString(),
    }],
  ]);
  const persistentUserStates = new Map([
    ['doc_realtime_001:client_001', createUserOpState({
      docId: 'doc_realtime_001',
      clientId: 'client_001',
      undoStackJson: [{ sourceSeq: 7, opType: 'set_cell' }],
      redoStackJson: [],
    })],
  ]);

  const store = createDocRealtimeRedisStore({
    persistentDocStore: {
      async getDocState(docId) {
        return persistentDocs.get(docId) || null;
      },
    },
    persistentSnapshotCheckpointStore: {
      async getLatestByDocId(docId) {
        return persistentCheckpoints.get(docId) || null;
      },
    },
    persistentDocBarrierStore: {
      async getByDocId(docId) {
        return persistentBarriers.get(docId) || null;
      },
    },
    persistentUserOpStateStore: {
      async getState(docId, clientId) {
        return persistentUserStates.get(`${docId}:${clientId}`) || null;
      },
    },
  });

  try {
    const realtimeDoc = await store.getRealtimeDoc('doc_realtime_001');
    assert.equal(realtimeDoc.currentSeq, 7);
    assert.equal(realtimeDoc.title, 'Checkpoint Doc');
    assert.equal(realtimeDoc.snapshotJson.sheets.sheet_doc_realtime_001_001.cells['1:1'].value, 'checkpoint-seed');

    const loadedBarrier = await store.getBarrier('doc_realtime_001');
    assert.equal(loadedBarrier.seq, 7);
    assert.equal(loadedBarrier.opType, 'import_sheet');

    const nextSeq = await store.allocateNextSeq('doc_realtime_001');
    assert.equal(nextSeq, 8);
    assert.equal(await store.getCurrentSeq('doc_realtime_001'), 8);

    const userState = await store.getUserOpState('doc_realtime_001', 'client_001');
    assert.equal(userState.undoStackJson.length, 1);
    assert.equal(userState.undoStackJson[0].sourceSeq, 7);

    await store.saveUserOpState({
      docId: 'doc_realtime_001',
      clientId: 'client_002',
      undoStackJson: [],
      redoStackJson: [{ sourceSeq: 8, opType: 'redo' }],
    });
    const savedUserState = await store.getUserOpState('doc_realtime_001', 'client_002');
    assert.equal(savedUserState.redoStackJson.length, 1);
    assert.equal(savedUserState.redoStackJson[0].sourceSeq, 8);

    await store.setBarrier('doc_realtime_001', {
      opType: 'import_sheet',
      seq: 8,
    });
    const barrier = await store.getBarrier('doc_realtime_001');
    assert.deepEqual(barrier, {
      opType: 'import_sheet',
      seq: 8,
    });

    const streamId = await store.appendOp('doc_realtime_001', {
      opType: 'set_title',
      seq: 8,
      title: 'renamed',
    });
    assert.equal(typeof streamId, 'string');

    const ops = await store.listOps('doc_realtime_001');
    assert.equal(ops.length, 1);
    assert.equal(ops[0].op.opType, 'set_title');
    assert.equal(ops[0].op.seq, 8);
    assert.equal(ops[0].op.title, 'renamed');
  } finally {
    await store.close();
  }
});
