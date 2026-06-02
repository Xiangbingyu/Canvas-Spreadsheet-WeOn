'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { resetMysqlDatabase } = require('../scripts/dbReset');
const { createRedisConnection } = require('../infra/redis/client');

const projectRoot = path.resolve(__dirname, '..');
const serverEntry = path.join(projectRoot, 'server.js');
const envFilePath = path.join(projectRoot, '.env');
const DEFAULT_SHEET_ID = 'sheet_20260527_001';

async function resetRedisTestKeys() {
  const client = createRedisConnection('multi-instance-test-reset');

  try {
    await client.connect();

    for await (const keys of client.scanIterator({ MATCH: 'collab:*', COUNT: 100 })) {
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

async function teardownTestStore() {
  if (process.env.STORE_DRIVER !== 'mysql') {
    return;
  }

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const { closePool } = require('../db/mysql');
  await closePool();
}

async function getFreePort() {
  const server = http.createServer();
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

function waitForServerReady(child, port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(`server ${port} start timeout\nstdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', handleStdout);
      child.stderr.off('data', handleStderr);
      child.off('exit', handleExit);
    }

    function handleStdout(chunk) {
      stdoutBuffer += chunk.toString();
      if (stdoutBuffer.includes(`Server listening on port ${port}`) && !settled) {
        settled = true;
        cleanup();
        resolve({
          stdoutBuffer,
          stderrBuffer,
        });
      }
    }

    function handleStderr(chunk) {
      stderrBuffer += chunk.toString();
    }

    function handleExit(code) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(new Error(`server ${port} exited early with code ${code}\nstdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`));
    }

    child.stdout.on('data', handleStdout);
    child.stderr.on('data', handleStderr);
    child.on('exit', handleExit);
  });
}

async function startServerInstance({ port, serverId }) {
  const nodeArgs = fs.existsSync(envFilePath)
    ? ['--env-file=.env', serverEntry]
    : [serverEntry];

  const child = spawn(
    process.execPath,
    nodeArgs,
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(port),
        SERVER_ID: serverId,
        STORE_DRIVER: 'mysql',
        RUNTIME_STATE_DRIVER: 'redis',
        COLLAB_BROADCAST_DRIVER: 'redis',
        IDEMPOTENCY_DRIVER: 'redis',
        DOC_LOCK_DRIVER: 'redis',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const readyInfo = await waitForServerReady(child, port);

  return {
    port,
    serverId,
    child,
    readyInfo,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode !== null) {
        return;
      }

      child.kill();
      await once(child, 'exit').catch(() => {});
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

  async function close() {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
      await once(ws, 'close').catch(() => {});
    }
  }

  return {
    ws,
    received,
    send(message) {
      ws.send(JSON.stringify(message));
    },
    async waitFor(predicate, timeoutMs = 5000) {
      const startIndex = 0;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        for (let index = startIndex; index < received.length; index += 1) {
          const message = received[index];
          if (predicate(message)) {
            return message;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      throw new Error(`waitFor timeout after ${timeoutMs}ms\nreceived:\n${JSON.stringify(received, null, 2)}`);
    },
    close,
  };
}

function getActiveSheetSnapshot(snapshot) {
  assert.ok(snapshot && typeof snapshot === 'object');
  assert.ok(typeof snapshot.activeSheetId === 'string' && snapshot.activeSheetId);
  assert.ok(snapshot.sheets && typeof snapshot.sheets === 'object');
  return snapshot.sheets[snapshot.activeSheetId];
}

function withDefaultSheetId(message) {
  return {
    sheetId: DEFAULT_SHEET_ID,
    ...message,
  };
}

test.beforeEach(async () => {
  await resetMysqlDatabase({
    closePoolAfterReset: false,
    silent: true,
  });
  await resetRedisTestKeys();
});

test.after(async () => {
  await teardownTestStore();
});

test('redis pubsub broadcasts join/add_sheet/set_cell/set_title/import_sheet/undo/redo across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'test-server-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'test-server-b' });

  const clientA = await connect(serverA.wsUrl);
  const clientB = await connect(serverB.wsUrl);

  try {
    clientA.send({ type: 'join', docId: 'doc_sys_001', clientId: 'uA' });
    await clientA.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'uA');

    clientB.send({ type: 'join', docId: 'doc_sys_001', clientId: 'uB' });
    await clientB.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'uB');

    const joinPresence = await clientA.waitFor((message) => (
      message.type === 'presence'
      && message.data.docId === 'doc_sys_001'
      && Array.isArray(message.data.users)
      && message.data.users.some((user) => user.clientId === 'uA')
      && message.data.users.some((user) => user.clientId === 'uB')
    ));
    assert.equal(joinPresence.type, 'presence');

    clientA.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'uA',
      title: 'cross-instance-title',
    });
    const titleUpdated = await clientB.waitFor((message) => (
      message.type === 'title_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.title === 'cross-instance-title'
    ));
    assert.equal(titleUpdated.data.title, 'cross-instance-title');

    clientA.send({
      type: 'add_sheet',
      docId: 'doc_sys_001',
      clientId: 'uA',
      sheetName: 'Cross Instance Sheet',
    });
    const sheetAdded = await clientB.waitFor((message) => (
      message.type === 'sheet_added'
      && message.data.docId === 'doc_sys_001'
      && message.data.sheet
      && message.data.sheet.name === 'Cross Instance Sheet'
    ));
    assert.equal(sheetAdded.data.activeSheetId, sheetAdded.data.sheet.id);
    assert.ok(sheetAdded.data.sheetOrder.includes(sheetAdded.data.sheet.id));
    const addedSheetId = sheetAdded.data.sheet.id;

    clientA.send({
      type: 'set_cell',
      sheetId: addedSheetId,
      docId: 'doc_sys_001',
      clientId: 'uA',
      row: 9,
      col: 1,
      value: 'from-a',
    });
    const cellUpdated = await clientB.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 9
      && message.data.col === 1
      && message.data.value === 'from-a'
    ));
    assert.equal(cellUpdated.data.value, 'from-a');

    clientA.send({
      type: 'undo',
      docId: 'doc_sys_001',
      clientId: 'uA',
    });
    const undoApplied = await clientB.waitFor((message) => (
      message.type === 'undo_applied'
      && message.data.docId === 'doc_sys_001'
      && message.data.sheetId === addedSheetId
      && message.data.row === 9
      && message.data.col === 1
      && message.data.value === ''
    ));
    assert.equal(undoApplied.data.value, '');

    clientA.send({
      type: 'redo',
      docId: 'doc_sys_001',
      clientId: 'uA',
    });
    const redoApplied = await clientB.waitFor((message) => (
      message.type === 'redo_applied'
      && message.data.docId === 'doc_sys_001'
      && message.data.sheetId === addedSheetId
      && message.data.row === 9
      && message.data.col === 1
      && message.data.value === 'from-a'
    ));
    assert.equal(redoApplied.data.value, 'from-a');

    clientA.send({
       type: 'insert_row',
      docId: 'doc_sys_001',
      clientId: 'uA',
      sheetId: addedSheetId,
      row: 9,
    });
    const rowInserted = await clientB.waitFor((message) => (
      message.type === 'row_inserted'
      && message.data.docId === 'doc_sys_001'
      && message.data.sheetId === addedSheetId
      && message.data.row === 9
    ));
    assert.equal(rowInserted.data.canUndo, false);
    assert.equal(rowInserted.data.canRedo, false);

    clientA.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'uA',
      snapshot: {
        id: 'sheet_doc_sys_001_import',
        name: 'Imported',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '1:1': {
            row: 1,
            col: 1,
            value: 'imported-value',
            styleId: null,
          },
        },
        styles: {},
        rowCount: 1,
        colCount: 1,
      },
    });
    const sheetImported = await clientB.waitFor((message) => (
      message.type === 'sheet_imported'
      && message.data.docId === 'doc_sys_001'
      && message.data.snapshot
      && getActiveSheetSnapshot(message.data.snapshot)
      && getActiveSheetSnapshot(message.data.snapshot).cells['1:1']
      && getActiveSheetSnapshot(message.data.snapshot).cells['1:1'].value === 'imported-value'
    ));
    assert.equal(getActiveSheetSnapshot(sheetImported.data.snapshot).cells['1:1'].value, 'imported-value');
  } finally {
    await clientA.close();
    await clientB.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('presence request returns cross-instance users and leave presence syncs across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'test-server-a-presence' });
  const serverB = await startServerInstance({ port: portB, serverId: 'test-server-b-presence' });

  const clientA = await connect(serverA.wsUrl);
  const clientB = await connect(serverB.wsUrl);

  try {
    clientA.send({ type: 'join', docId: 'doc_sys_001', clientId: 'presence-a' });
    await clientA.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'presence-a');

    clientB.send({ type: 'join', docId: 'doc_sys_001', clientId: 'presence-b' });
    await clientB.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'presence-b');

    await clientA.waitFor((message) => (
      message.type === 'presence'
      && message.data.docId === 'doc_sys_001'
      && Array.isArray(message.data.users)
      && message.data.users.some((user) => user.clientId === 'presence-a')
      && message.data.users.some((user) => user.clientId === 'presence-b')
    ));

    clientA.send({ type: 'presence', docId: 'doc_sys_001' });
    const presenceReply = await clientA.waitFor((message) => (
      message.type === 'presence'
      && message.data.docId === 'doc_sys_001'
      && Array.isArray(message.data.users)
      && message.data.users.some((user) => user.clientId === 'presence-a')
      && message.data.users.some((user) => user.clientId === 'presence-b')
    ));
    assert.equal(
      presenceReply.data.users.filter((user) => ['presence-a', 'presence-b'].includes(user.clientId)).length,
      2
    );

    await clientB.close();

    const leavePresence = await clientA.waitFor((message) => (
      message.type === 'presence'
      && message.data.docId === 'doc_sys_001'
      && Array.isArray(message.data.users)
      && message.data.users.some((user) => user.clientId === 'presence-a')
      && !message.data.users.some((user) => user.clientId === 'presence-b')
    ));
    assert.equal(
      leavePresence.data.users.filter((user) => user.clientId === 'presence-b').length,
      0
    );
  } finally {
    await clientA.close();
    await clientB.close().catch(() => {});
    await serverA.stop();
    await serverB.stop();
  }
});

test('cursor updates broadcast across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'test-server-a-cursor' });
  const serverB = await startServerInstance({ port: portB, serverId: 'test-server-b-cursor' });

  const clientA = await connect(serverA.wsUrl);
  const clientB = await connect(serverB.wsUrl);

  try {
    clientA.send({ type: 'join', docId: 'doc_sys_001', clientId: 'cursor-a' });
    await clientA.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'cursor-a');

    clientB.send({ type: 'join', docId: 'doc_sys_001', clientId: 'cursor-b' });
    await clientB.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'cursor-b');

    await clientA.waitFor((message) => (
      message.type === 'presence'
      && message.data.docId === 'doc_sys_001'
      && Array.isArray(message.data.users)
      && message.data.users.some((user) => user.clientId === 'cursor-a')
      && message.data.users.some((user) => user.clientId === 'cursor-b')
    ));

    clientA.send({
      type: 'cursor',
      sheetID: 'sheet_01',
      docId: 'doc_sys_001',
      clientId: 'cursor-a',
      row: 8,
      col: 2,
    });

    const expectedPayload = {
      type: 'cursor_update',
      code: 0,
      message: 'ok',
      data: {
        docId: 'doc_sys_001',
        sheetID: 'sheet_01',
        clientId: 'cursor-a',
        row: 8,
        col: 2,
      },
    };

    const senderCursor = await clientA.waitFor((message) => (
      message.type === 'cursor_update'
      && message.data.docId === 'doc_sys_001'
      && message.data.sheetID === 'sheet_01'
      && message.data.clientId === 'cursor-a'
      && message.data.row === 8
      && message.data.col === 2
    ));
    const otherCursor = await clientB.waitFor((message) => (
      message.type === 'cursor_update'
      && message.data.docId === 'doc_sys_001'
      && message.data.sheetID === 'sheet_01'
      && message.data.clientId === 'cursor-a'
      && message.data.row === 8
      && message.data.col === 2
    ));

    assert.deepEqual(senderCursor, expectedPayload);
    assert.deepEqual(otherCursor, expectedPayload);
  } finally {
    await clientA.close();
    await clientB.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('same client stays online until last cross-instance socket disconnects', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'test-server-a-runtime' });
  const serverB = await startServerInstance({ port: portB, serverId: 'test-server-b-runtime' });

  const observer = await connect(serverA.wsUrl);
  const socketA = await connect(serverA.wsUrl);
  const socketB = await connect(serverB.wsUrl);

  try {
    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'observer' });
    await observer.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'observer');

    socketA.send({ type: 'join', docId: 'doc_sys_001', clientId: 'shared-user' });
    await socketA.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'shared-user');

    socketB.send({ type: 'join', docId: 'doc_sys_001', clientId: 'shared-user' });
    await socketB.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'shared-user');

    await observer.waitFor((message) => (
      message.type === 'presence'
      && message.data.docId === 'doc_sys_001'
      && Array.isArray(message.data.users)
      && message.data.users.some((user) => user.clientId === 'observer')
      && message.data.users.some((user) => user.clientId === 'shared-user')
    ));

    await socketA.close();

    observer.send({ type: 'presence', docId: 'doc_sys_001' });
    const afterFirstClose = await observer.waitFor((message) => (
      message.type === 'presence'
      && message.data.docId === 'doc_sys_001'
      && Array.isArray(message.data.users)
      && message.data.users.some((user) => user.clientId === 'observer')
      && message.data.users.some((user) => user.clientId === 'shared-user')
    ));
    assert.equal(
      afterFirstClose.data.users.filter((user) => user.clientId === 'shared-user').length,
      1
    );

    await socketB.close();

    const afterLastClose = await observer.waitFor((message) => (
      message.type === 'presence'
      && message.data.docId === 'doc_sys_001'
      && Array.isArray(message.data.users)
      && message.data.users.some((user) => user.clientId === 'observer')
      && !message.data.users.some((user) => user.clientId === 'shared-user')
    ));
    assert.equal(
      afterLastClose.data.users.filter((user) => user.clientId === 'shared-user').length,
      0
    );
  } finally {
    await observer.close();
    await socketA.close().catch(() => {});
    await socketB.close().catch(() => {});
    await serverA.stop();
    await serverB.stop();
  }
});
