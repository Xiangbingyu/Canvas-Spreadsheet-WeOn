'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const WebSocket = require('ws');

const { resetMysqlDatabase } = require('../scripts/dbReset');
const { resetRedisTestKeys } = require('./helpers/resetRedisTestKeys');

const projectRoot = path.resolve(__dirname, '..');

async function closeProjectResources() {
  const cacheModulePath = path.join(projectRoot, 'cache', 'index.js');
  const roomServiceModulePath = path.join(projectRoot, 'service', 'roomService.js');
  const idempotencyServiceModulePath = path.join(projectRoot, 'idempotency', 'idempotencyService.js');
  const lockModulePath = path.join(projectRoot, 'infra', 'redis', 'lock.js');
  const docRealtimeServiceModulePath = path.join(projectRoot, 'service', 'docRealtimeService.js');
  const workerModulePath = path.join(projectRoot, 'worker', 'opLogFlushWorker.js');

  if (require.cache[cacheModulePath]) {
    await require(cacheModulePath).close();
  }

  if (require.cache[roomServiceModulePath]) {
    await require(roomServiceModulePath).closeRuntimeState();
  }

  if (require.cache[idempotencyServiceModulePath]) {
    await require(idempotencyServiceModulePath).close();
  }

  if (require.cache[lockModulePath]) {
    await require(lockModulePath).close();
  }

  if (require.cache[docRealtimeServiceModulePath]) {
    await require(docRealtimeServiceModulePath).closeRuntimeState();
  }

  if (require.cache[workerModulePath]) {
    await require(workerModulePath).close();
  }
}

function clearBackendRequireCache() {
  for (const modulePath of Object.keys(require.cache)) {
    const keepMysqlModules = process.env.STORE_DRIVER === 'mysql'
      && modulePath.includes(`${path.sep}db${path.sep}mysql${path.sep}`);

    if (
      modulePath.startsWith(projectRoot) &&
      !modulePath.includes(`${path.sep}node_modules${path.sep}`) &&
      !keepMysqlModules &&
      modulePath !== __filename
    ) {
      delete require.cache[modulePath];
    }
  }
}

test.beforeEach(async () => {
  await closeProjectResources();
  await resetMysqlDatabase({
    closePoolAfterReset: false,
    silent: true,
  });
  await resetRedisTestKeys();
  clearBackendRequireCache();
});

test.after(async () => {
  await closeProjectResources();
  const { closePool } = require('../db/mysql');
  await closePool();
  clearBackendRequireCache();
});

async function createTestServer() {
  const app = require('../app');
  const { createWebSocketServer } = require('../ws');

  const server = http.createServer(app);
  const wss = createWebSocketServer(server);
  server.listen(0);
  await once(server, 'listening');
  await Promise.resolve(wss.ready);

  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    async close() {
      await wss.shutdown();
      server.close();
      await once(server, 'close');
    },
  };
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await once(ws, 'open');
  const received = [];
  ws.on('message', (raw) => {
    received.push(JSON.parse(raw.toString()));
  });

  return {
    send(message) {
      ws.send(JSON.stringify(message));
    },
    async waitFor(predicate, timeoutMs = 3000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        for (const message of received) {
          if (predicate(message)) {
            return message;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      throw new Error(`waitFor timeout: ${JSON.stringify(received, null, 2)}`);
    },
    async close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
        await once(ws, 'close').catch(() => {});
      }
    },
  };
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    status: response.status,
    json: await response.json(),
  };
}

async function waitForCondition(predicate, timeoutMs = 4000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('condition not satisfied before timeout');
}

function getCell(snapshot, sheetId, row, col) {
  return snapshot
    && snapshot.sheets
    && snapshot.sheets[sheetId]
    && snapshot.sheets[sheetId].cells
    && snapshot.sheets[sheetId].cells[`${row}:${col}`];
}

test('set_title and set_cell confirm in redis then flush doc and history to mysql asynchronously', async () => {
  const server = await createTestServer();
  const client = await connect(server.wsUrl);

  try {
    client.send({ type: 'join', docId: 'doc_sys_001', clientId: 'realtime-editor' });
    const joinAck = await client.waitFor((message) => (
      message.type === 'join_ack' && message.data.clientId === 'realtime-editor'
    ));
    const sheetId = joinAck.data.snapshot.activeSheetId;

    client.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'realtime-editor',
      title: 'redis-confirmed-title',
    });
    const titleReply = await client.waitFor((message) => (
      message.type === 'title_updated' && message.data.title === 'redis-confirmed-title'
    ));

    const immediateDocRead = await getJson(server.baseUrl, '/docs/doc_sys_001');
    assert.equal(immediateDocRead.status, 200);
    assert.equal(immediateDocRead.json.data.title, 'redis-confirmed-title');

    const docStore = require('../store/docStore');
    const historyStore = require('../store/historyStore');
    const snapshotCheckpointStore = require('../store/snapshotCheckpointStore');

    await waitForCondition(async () => {
      const persistedDoc = await docStore.getDocState('doc_sys_001');
      const persistedHistory = await historyStore.findByDocIdAndSeq('doc_sys_001', titleReply.data.seq);
      const checkpoint = await snapshotCheckpointStore.getLatestByDocId('doc_sys_001');
      return persistedDoc
        && persistedDoc.title === 'redis-confirmed-title'
        && persistedDoc.currentSeq >= titleReply.data.seq
        && persistedHistory
        && persistedHistory.opType === 'set_title'
        && checkpoint
        && checkpoint.checkpointSeq >= titleReply.data.seq
        && checkpoint.title === 'redis-confirmed-title';
    });

    client.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'realtime-editor',
      sheetId,
      row: 40,
      col: 2,
      value: 'redis-confirmed-cell',
    });
    const cellReply = await client.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.row === 40
      && message.data.col === 2
      && message.data.value === 'redis-confirmed-cell'
    ));

    const immediateCellRead = await getJson(server.baseUrl, '/docs/doc_sys_001');
    assert.equal(immediateCellRead.status, 200);
    assert.equal(
      immediateCellRead.json.data.snapshot.sheets[sheetId].cells['40:2'].value,
      'redis-confirmed-cell'
    );

    await waitForCondition(async () => {
      const persistedDoc = await docStore.getDocState('doc_sys_001');
      const persistedHistory = await historyStore.findByDocIdAndSeq('doc_sys_001', cellReply.data.seq);
      const persistedCell = persistedDoc
        && persistedDoc.snapshotJson
        && persistedDoc.snapshotJson.sheets
        && persistedDoc.snapshotJson.sheets[sheetId]
        && persistedDoc.snapshotJson.sheets[sheetId].cells['40:2'];

      return persistedDoc
        && persistedDoc.currentSeq >= cellReply.data.seq
        && persistedCell
        && persistedCell.value === 'redis-confirmed-cell'
        && persistedHistory
        && persistedHistory.opType === 'set_cell';
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test('undo redo and import_sheet confirm in redis then flush to mysql asynchronously', async () => {
  const server = await createTestServer();
  const client = await connect(server.wsUrl);

  try {
    client.send({ type: 'join', docId: 'doc_sys_001', clientId: 'realtime-undo-editor' });
    const joinAck = await client.waitFor((message) => (
      message.type === 'join_ack' && message.data.clientId === 'realtime-undo-editor'
    ));
    const sheetId = joinAck.data.snapshot.activeSheetId;

    client.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'realtime-undo-editor',
      sheetId,
      row: 41,
      col: 1,
      value: 'undo-seed',
    });
    await client.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.row === 41
      && message.data.col === 1
      && message.data.value === 'undo-seed'
    ));

    client.send({
      type: 'undo',
      docId: 'doc_sys_001',
      clientId: 'realtime-undo-editor',
    });
    const undoReply = await client.waitFor((message) => (
      message.type === 'undo_applied'
      && message.data.row === 41
      && message.data.col === 1
      && message.data.value === ''
    ));

    let immediateDocRead = await getJson(server.baseUrl, '/docs/doc_sys_001');
    assert.equal(immediateDocRead.status, 200);
    assert.equal(getCell(immediateDocRead.json.data.snapshot, sheetId, 41, 1).value, '');

    const docStore = require('../store/docStore');
    const historyStore = require('../store/historyStore');
    const userOpStateStore = require('../store/userOpStateStore');
    const snapshotCheckpointStore = require('../store/snapshotCheckpointStore');
    const docBarrierStore = require('../store/docBarrierStore');

    await waitForCondition(async () => {
      const persistedDoc = await docStore.getDocState('doc_sys_001');
      const persistedHistory = await historyStore.findByDocIdAndSeq('doc_sys_001', undoReply.data.seq);
      const persistedCell = persistedDoc && getCell(persistedDoc.snapshotJson, sheetId, 41, 1);
      const persistedUserState = await userOpStateStore.getState('doc_sys_001', 'realtime-undo-editor');

      return persistedDoc
        && persistedCell
        && persistedCell.value === ''
        && persistedHistory
        && persistedHistory.opType === 'undo'
        && persistedUserState
        && persistedUserState.redoStackJson.length > 0;
    });

    client.send({
      type: 'redo',
      docId: 'doc_sys_001',
      clientId: 'realtime-undo-editor',
    });
    const redoReply = await client.waitFor((message) => (
      message.type === 'redo_applied'
      && message.data.row === 41
      && message.data.col === 1
      && message.data.value === 'undo-seed'
    ));

    immediateDocRead = await getJson(server.baseUrl, '/docs/doc_sys_001');
    assert.equal(immediateDocRead.status, 200);
    assert.equal(getCell(immediateDocRead.json.data.snapshot, sheetId, 41, 1).value, 'undo-seed');

    await waitForCondition(async () => {
      const persistedDoc = await docStore.getDocState('doc_sys_001');
      const persistedHistory = await historyStore.findByDocIdAndSeq('doc_sys_001', redoReply.data.seq);
      const persistedCell = persistedDoc && getCell(persistedDoc.snapshotJson, sheetId, 41, 1);
      return persistedDoc
        && persistedCell
        && persistedCell.value === 'undo-seed'
        && persistedHistory
        && persistedHistory.opType === 'redo';
    });

    const importSnapshot = {
      activeSheetId: 'sheet_import_001',
      sheetOrder: ['sheet_import_001'],
      sheets: {
        sheet_import_001: {
          id: 'sheet_import_001',
          name: 'ImportedSheet',
          defaultRowHeight: 25,
          defaultColWidth: 100,
          cells: {
            '2:2': {
              row: 2,
              col: 2,
              value: 'imported-value',
              styleId: null,
            },
          },
          styles: {},
          rowCount: 2,
          colCount: 2,
        },
      },
    };

    client.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'realtime-undo-editor',
      snapshot: importSnapshot,
    });
    const importReply = await client.waitFor((message) => (
      message.type === 'sheet_imported'
      && message.data.snapshot
      && getCell(message.data.snapshot, 'sheet_import_001', 2, 2)
      && getCell(message.data.snapshot, 'sheet_import_001', 2, 2).value === 'imported-value'
    ));

    immediateDocRead = await getJson(server.baseUrl, '/docs/doc_sys_001');
    assert.equal(immediateDocRead.status, 200);
    assert.equal(getCell(immediateDocRead.json.data.snapshot, 'sheet_import_001', 2, 2).value, 'imported-value');

    await waitForCondition(async () => {
      const persistedDoc = await docStore.getDocState('doc_sys_001');
      const persistedHistory = await historyStore.findByDocIdAndSeq('doc_sys_001', importReply.data.seq);
      const persistedUserState = await userOpStateStore.getState('doc_sys_001', 'realtime-undo-editor');
      const checkpoint = await snapshotCheckpointStore.getLatestByDocId('doc_sys_001');
      const barrier = await docBarrierStore.getByDocId('doc_sys_001');

      return persistedDoc
        && getCell(persistedDoc.snapshotJson, 'sheet_import_001', 2, 2)
        && getCell(persistedDoc.snapshotJson, 'sheet_import_001', 2, 2).value === 'imported-value'
        && persistedHistory
        && persistedHistory.opType === 'import_sheet'
        && persistedUserState
        && persistedUserState.undoStackJson.length === 0
        && persistedUserState.redoStackJson.length === 0
        && checkpoint
        && checkpoint.checkpointSeq >= importReply.data.seq
        && getCell(checkpoint.snapshotJson, 'sheet_import_001', 2, 2).value === 'imported-value'
        && barrier
        && barrier.seq === importReply.data.seq
        && barrier.opType === 'import_sheet';
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test('add_sheet and row col structure changes confirm in redis then flush to mysql asynchronously', async () => {
  const server = await createTestServer();
  const client = await connect(server.wsUrl);

  try {
    client.send({ type: 'join', docId: 'doc_sys_001', clientId: 'realtime-structure-editor' });
    const joinAck = await client.waitFor((message) => (
      message.type === 'join_ack' && message.data.clientId === 'realtime-structure-editor'
    ));
    const baseSheetId = joinAck.data.snapshot.activeSheetId;

    client.send({
      type: 'add_sheet',
      docId: 'doc_sys_001',
      clientId: 'realtime-structure-editor',
      sheetName: 'RealtimeAdded',
    });
    const addSheetReply = await client.waitFor((message) => (
      message.type === 'sheet_added'
      && message.data.sheet
      && message.data.sheet.name === 'RealtimeAdded'
    ));
    const addedSheetId = addSheetReply.data.sheet.id;

    let immediateDocRead = await getJson(server.baseUrl, '/docs/doc_sys_001');
    assert.equal(immediateDocRead.status, 200);
    assert.equal(immediateDocRead.json.data.snapshot.activeSheetId, addedSheetId);

    const docStore = require('../store/docStore');
    const historyStore = require('../store/historyStore');
    const userOpStateStore = require('../store/userOpStateStore');

    await waitForCondition(async () => {
      const persistedDoc = await docStore.getDocState('doc_sys_001');
      const persistedHistory = await historyStore.findByDocIdAndSeq('doc_sys_001', addSheetReply.data.seq);
      return persistedDoc
        && persistedDoc.snapshotJson.sheets[addedSheetId]
        && persistedDoc.snapshotJson.sheets[addedSheetId].name === 'RealtimeAdded'
        && persistedHistory
        && persistedHistory.opType === 'add_sheet';
    });

    client.send({
      type: 'insert_row',
      docId: 'doc_sys_001',
      clientId: 'realtime-structure-editor',
      sheetId: baseSheetId,
      row: 1,
    });
    const insertRowReply = await client.waitFor((message) => (
      message.type === 'row_inserted'
      && message.data.sheetId === baseSheetId
      && message.data.row === 1
    ));

    await waitForCondition(async () => {
      const persistedHistory = await historyStore.findByDocIdAndSeq('doc_sys_001', insertRowReply.data.seq);
      const persistedUserState = await userOpStateStore.getState('doc_sys_001', 'realtime-structure-editor');
      return persistedHistory
        && persistedHistory.opType === 'insert_row'
        && (!persistedUserState
          || (
            persistedUserState.undoStackJson.length === 0
            && persistedUserState.redoStackJson.length === 0
          ));
    });

    client.send({
      type: 'delete_row',
      docId: 'doc_sys_001',
      clientId: 'realtime-structure-editor',
      sheetId: baseSheetId,
      row: 1,
    });
    const deleteRowReply = await client.waitFor((message) => (
      message.type === 'row_deleted'
      && message.data.sheetId === baseSheetId
      && message.data.row === 1
    ));

    client.send({
      type: 'insert_col',
      docId: 'doc_sys_001',
      clientId: 'realtime-structure-editor',
      sheetId: baseSheetId,
      col: 1,
    });
    const insertColReply = await client.waitFor((message) => (
      message.type === 'col_inserted'
      && message.data.sheetId === baseSheetId
      && message.data.col === 1
    ));

    client.send({
      type: 'delete_col',
      docId: 'doc_sys_001',
      clientId: 'realtime-structure-editor',
      sheetId: baseSheetId,
      col: 1,
    });
    const deleteColReply = await client.waitFor((message) => (
      message.type === 'col_deleted'
      && message.data.sheetId === baseSheetId
      && message.data.col === 1
    ));

    immediateDocRead = await getJson(server.baseUrl, '/docs/doc_sys_001');
    assert.equal(immediateDocRead.status, 200);
    assert.ok(immediateDocRead.json.data.snapshot.sheets[baseSheetId]);

    await waitForCondition(async () => {
      const persistedHistoryKinds = await Promise.all([
        historyStore.findByDocIdAndSeq('doc_sys_001', deleteRowReply.data.seq),
        historyStore.findByDocIdAndSeq('doc_sys_001', insertColReply.data.seq),
        historyStore.findByDocIdAndSeq('doc_sys_001', deleteColReply.data.seq),
      ]);

      return persistedHistoryKinds[0]
        && persistedHistoryKinds[0].opType === 'delete_row'
        && persistedHistoryKinds[1]
        && persistedHistoryKinds[1].opType === 'insert_col'
        && persistedHistoryKinds[2]
        && persistedHistoryKinds[2].opType === 'delete_col';
    });
  } finally {
    await client.close();
    await server.close();
  }
});
