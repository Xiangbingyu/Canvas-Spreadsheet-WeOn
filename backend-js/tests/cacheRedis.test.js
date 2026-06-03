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
  const client = createRedisConnection('cache-redis-test-reset');

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
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const { closePool } = require('../db/mysql');
  await closePool();
}

async function closeProjectResources() {
  const cacheModulePath = path.join(projectRoot, 'cache', 'index.js');
  const roomServiceModulePath = path.join(projectRoot, 'service', 'roomService.js');
  const idempotencyServiceModulePath = path.join(projectRoot, 'idempotency', 'idempotencyService.js');
  const lockModulePath = path.join(projectRoot, 'infra', 'redis', 'lock.js');
  const asyncWriteQueueModulePath = path.join(projectRoot, 'infra', 'asyncWriteQueue.js');

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

  if (require.cache[asyncWriteQueueModulePath]) {
    await require(asyncWriteQueueModulePath).close();
  }
}

function clearBackendRequireCache() {
  for (const modulePath of Object.keys(require.cache)) {
    const keepMysqlModules = modulePath.includes(`${path.sep}db${path.sep}mysql${path.sep}`);

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

async function getFreePort() {
  const server = http.createServer();
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForAsync(assertion, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError || new Error('waitForAsync timed out');
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
        resolve();
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
        CACHE_DRIVER: 'redis',
        IDEMPOTENCY_DRIVER: 'redis',
        DOC_LOCK_DRIVER: 'redis',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  await waitForServerReady(child, port);

  return {
    port,
    serverId,
    child,
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

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);

  return {
    status: response.status,
    json: await response.json(),
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

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    json: await response.json(),
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
    received,
    send(message) {
      ws.send(JSON.stringify(message));
    },
    async waitFor(predicate, timeoutMs = 5000) {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        for (const message of received) {
          if (predicate(message)) {
            return message;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      throw new Error(`waitFor timeout after ${timeoutMs}ms\nreceived:\n${JSON.stringify(received, null, 2)}`);
    },
    async close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
        await once(ws, 'close').catch(() => {});
      }
    },
  };
}

async function joinRoom(client, docId, clientId) {
  client.send({ type: 'join', docId, clientId });
  return client.waitFor((message) => message.type === 'join_ack' && message.data.clientId === clientId);
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

test('redis cache keeps cross-instance doc snapshot and list reads fresh after invalidation', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'cache-redis-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'cache-redis-b' });
  const editor = await connect(serverA.wsUrl);
  const observer = await connect(serverB.wsUrl);

  try {
    const firstDocRead = await getJson(serverA.baseUrl, '/docs/doc_sys_001');
    assert.equal(firstDocRead.status, 200);
    assert.equal(firstDocRead.json.data.docId, 'doc_sys_001');

    const firstListRead = await getJson(serverB.baseUrl, '/docs?userId=system&scope=created&page=1&pageSize=20');
    assert.equal(firstListRead.status, 200);
    assert.ok(firstListRead.json.data.list.some((doc) => doc.docId === 'doc_sys_001'));

    editor.send({ type: 'join', docId: 'doc_sys_001', clientId: 'cache-editor' });
    await editor.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'cache-editor');

    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'cache-observer' });
    await observer.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'cache-observer');

    editor.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'cache-editor',
      title: 'redis-cache-updated-title',
    });

    await observer.waitFor((message) => (
      message.type === 'title_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.title === 'redis-cache-updated-title'
    ));

    const secondDocRead = await getJson(serverB.baseUrl, '/docs/doc_sys_001');
    assert.equal(secondDocRead.status, 200);
    assert.equal(secondDocRead.json.data.title, 'redis-cache-updated-title');

    const secondListRead = await getJson(serverA.baseUrl, '/docs?userId=system&scope=created&page=1&pageSize=20');
    assert.equal(secondListRead.status, 200);
    assert.equal(
      secondListRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001').title,
      'redis-cache-updated-title'
    );
  } finally {
    await editor.close();
    await observer.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis idempotency returns the same create-doc result across instances for duplicate eventId', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'redis-idempotency-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'redis-idempotency-b' });

  try {
    const [firstResponse, secondResponse] = await Promise.all([
      postJson(serverA.baseUrl, '/docs', {
        title: 'redis-idempotent-doc-a',
        createdBy: 'redis-idempotent-user',
        eventId: 'evt_redis_idempotent_create_001',
      }),
      postJson(serverB.baseUrl, '/docs', {
        title: 'redis-idempotent-doc-b',
        createdBy: 'redis-idempotent-user',
        eventId: 'evt_redis_idempotent_create_001',
      }),
    ]);

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    assert.deepEqual(secondResponse.json, firstResponse.json);

    const listResponse = await getJson(
      serverA.baseUrl,
      '/docs?userId=redis-idempotent-user&scope=created&page=1&pageSize=20'
    );
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.json.data.total, 1);
  } finally {
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis cache invalidates created-doc list across instances after POST /docs', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'cache-redis-create-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'cache-redis-create-b' });

  try {
    const userId = 'cache-list-create-user';
    const firstListRead = await getJson(serverA.baseUrl, `/docs?userId=${userId}&scope=created&page=1&pageSize=20`);
    assert.equal(firstListRead.status, 200);
    assert.equal(firstListRead.json.data.total, 0);

    const createResponse = await postJson(serverB.baseUrl, '/docs', {
      title: 'redis-cache-created-doc',
      createdBy: userId,
      eventId: 'evt_cache_redis_create_doc_001',
    });
    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.json.data.title, 'redis-cache-created-doc');

    const secondListRead = await getJson(serverA.baseUrl, `/docs?userId=${userId}&scope=created&page=1&pageSize=20`);
    assert.equal(secondListRead.status, 200);
    assert.equal(secondListRead.json.data.total, 1);
    assert.equal(secondListRead.json.data.list[0].title, 'redis-cache-created-doc');
  } finally {
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis cache invalidates GET /docs list after set_title across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'cache-redis-title-list-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'cache-redis-title-list-b' });
  const editor = await connect(serverA.wsUrl);
  const observer = await connect(serverB.wsUrl);

  try {
    const userId = 'system';
    const firstListRead = await getJson(serverA.baseUrl, `/docs?userId=${userId}&scope=created&page=1&pageSize=20`);
    assert.equal(firstListRead.status, 200);

    const beforeTargetDoc = firstListRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001');
    assert.ok(beforeTargetDoc);

    editor.send({ type: 'join', docId: 'doc_sys_001', clientId: 'cache-title-list-editor' });
    await editor.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'cache-title-list-editor');

    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'cache-title-list-observer' });
    await observer.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'cache-title-list-observer');

    editor.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'cache-title-list-editor',
      title: 'redis-cache-list-title-updated',
    });
    await observer.waitFor((message) => (
      message.type === 'title_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.title === 'redis-cache-list-title-updated'
    ));

    const secondListRead = await getJson(serverB.baseUrl, `/docs?userId=${userId}&scope=created&page=1&pageSize=20`);
    assert.equal(secondListRead.status, 200);

    const afterTargetDoc = secondListRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001');
    assert.ok(afterTargetDoc);
    assert.equal(afterTargetDoc.title, 'redis-cache-list-title-updated');
  } finally {
    await editor.close();
    await observer.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis cache serves fresh snapshot after insert_row across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'cache-redis-insert-row-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'cache-redis-insert-row-b' });
  const editor = await connect(serverA.wsUrl);
  const observer = await connect(serverB.wsUrl);

  try {
    const firstDocRead = await getJson(serverA.baseUrl, '/docs/doc_sys_001');
    assert.equal(firstDocRead.status, 200);
    assert.equal(firstDocRead.json.data.snapshot.sheets[DEFAULT_SHEET_ID].cells['1:1'].value, '9999.00');

    await joinRoom(editor, 'doc_sys_001', 'cache-insert-row-editor');
    await joinRoom(observer, 'doc_sys_001', 'cache-insert-row-observer');

    editor.send({
      type: 'insert_row',
      docId: 'doc_sys_001',
      clientId: 'cache-insert-row-editor',
      sheetId: DEFAULT_SHEET_ID,
      row: 1,
    });
    await observer.waitFor((message) => (
      message.type === 'row_inserted'
      && message.data.docId === 'doc_sys_001'
      && message.data.sheetId === DEFAULT_SHEET_ID
      && message.data.row === 1
    ));

    const secondDocRead = await getJson(serverB.baseUrl, '/docs/doc_sys_001');
    assert.equal(secondDocRead.status, 200);
    const sheet = secondDocRead.json.data.snapshot.sheets[DEFAULT_SHEET_ID];
    assert.equal(sheet.rowCount, 101);
    assert.equal(sheet.cells['1:1'], undefined);
    assert.equal(sheet.cells['2:1'].value, '9999.00');
  } finally {
    await editor.close();
    await observer.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis cache invalidates participated and all lists after set_title across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'cache-redis-participated-title-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'cache-redis-participated-title-b' });
  const owner = await connect(serverA.wsUrl);
  const participant = await connect(serverB.wsUrl);

  try {
    await joinRoom(owner, 'doc_sys_001', 'cache-participated-owner');
    await joinRoom(participant, 'doc_sys_001', 'cache-participated-user');

    const firstParticipatedRead = await getJson(
      serverA.baseUrl,
      '/docs?userId=cache-participated-user&scope=participated&page=1&pageSize=20'
    );
    assert.equal(firstParticipatedRead.status, 200);
    assert.ok(firstParticipatedRead.json.data.list.some((doc) => doc.docId === 'doc_sys_001'));

    const firstAllRead = await getJson(
      serverB.baseUrl,
      '/docs?userId=cache-participated-user&scope=all&page=1&pageSize=20'
    );
    assert.equal(firstAllRead.status, 200);
    assert.ok(firstAllRead.json.data.list.some((doc) => doc.docId === 'doc_sys_001'));

    owner.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'cache-participated-owner',
      title: 'redis-cache-participated-title-updated',
    });
    await participant.waitFor((message) => (
      message.type === 'title_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.title === 'redis-cache-participated-title-updated'
    ));

    const secondParticipatedRead = await getJson(
      serverB.baseUrl,
      '/docs?userId=cache-participated-user&scope=participated&page=1&pageSize=20'
    );
    assert.equal(secondParticipatedRead.status, 200);
    assert.equal(
      secondParticipatedRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001').title,
      'redis-cache-participated-title-updated'
    );

    const secondAllRead = await getJson(
      serverA.baseUrl,
      '/docs?userId=cache-participated-user&scope=all&page=1&pageSize=20'
    );
    assert.equal(secondAllRead.status, 200);
    assert.equal(
      secondAllRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001').title,
      'redis-cache-participated-title-updated'
    );
  } finally {
    await owner.close();
    await participant.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis cache invalidates participated and all lists after import_sheet across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'cache-redis-participated-import-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'cache-redis-participated-import-b' });
  const owner = await connect(serverA.wsUrl);
  const participant = await connect(serverB.wsUrl);

  try {
    await joinRoom(owner, 'doc_sys_001', 'cache-import-owner');
    await joinRoom(participant, 'doc_sys_001', 'cache-import-user');

    const firstParticipatedRead = await getJson(
      serverA.baseUrl,
      '/docs?userId=cache-import-user&scope=participated&page=1&pageSize=20'
    );
    assert.equal(firstParticipatedRead.status, 200);
    const initialParticipatedDoc = firstParticipatedRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001');
    assert.ok(initialParticipatedDoc);

    const firstAllRead = await getJson(
      serverB.baseUrl,
      '/docs?userId=cache-import-user&scope=all&page=1&pageSize=20'
    );
    assert.equal(firstAllRead.status, 200);
    const initialAllDoc = firstAllRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001');
    assert.ok(initialAllDoc);

    owner.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'cache-import-owner',
      snapshot: {
        id: 'sheet_doc_sys_001_participated_import',
        name: 'ParticipatedImport',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '5:5': {
            row: 5,
            col: 5,
            value: 'imported-list-seq',
            styleId: null,
          },
        },
        styles: {},
        rowCount: 5,
        colCount: 5,
      },
    });
    await participant.waitFor((message) => (
      message.type === 'sheet_imported'
      && message.data.docId === 'doc_sys_001'
      && message.data.snapshot
      && getActiveSheetSnapshot(message.data.snapshot)
      && getActiveSheetSnapshot(message.data.snapshot).cells['5:5']
      && getActiveSheetSnapshot(message.data.snapshot).cells['5:5'].value === 'imported-list-seq'
    ));

    const secondParticipatedRead = await getJson(
      serverB.baseUrl,
      '/docs?userId=cache-import-user&scope=participated&page=1&pageSize=20'
    );
    assert.equal(secondParticipatedRead.status, 200);
    const updatedParticipatedDoc = secondParticipatedRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001');
    assert.ok(updatedParticipatedDoc.currentSeq > initialParticipatedDoc.currentSeq);

    const secondAllRead = await getJson(
      serverA.baseUrl,
      '/docs?userId=cache-import-user&scope=all&page=1&pageSize=20'
    );
    assert.equal(secondAllRead.status, 200);
    const updatedAllDoc = secondAllRead.json.data.list.find((doc) => doc.docId === 'doc_sys_001');
    assert.ok(updatedAllDoc.currentSeq > initialAllDoc.currentSeq);
  } finally {
    await owner.close();
    await participant.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis doc lock keeps concurrent cross-instance set_cell writes ordered on the same doc', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'redis-doc-lock-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'redis-doc-lock-b' });
  const clientA = await connect(serverA.wsUrl);
  const clientB = await connect(serverB.wsUrl);

  try {
    await joinRoom(clientA, 'doc_sys_001', 'doc-lock-user-a');
    await joinRoom(clientB, 'doc_sys_001', 'doc-lock-user-b');

    const initialDocRead = await getJson(serverA.baseUrl, '/docs/doc_sys_001');
    assert.equal(initialDocRead.status, 200);
    const initialSeq = initialDocRead.json.data.currentSeq;

    clientA.send({
      type: 'set_cell',
      sheetId: DEFAULT_SHEET_ID,
      docId: 'doc_sys_001',
      clientId: 'doc-lock-user-a',
      row: 20,
      col: 1,
      value: 'lock-a',
    });
    clientB.send({
      type: 'set_cell',
      sheetId: DEFAULT_SHEET_ID,
      docId: 'doc_sys_001',
      clientId: 'doc-lock-user-b',
      row: 20,
      col: 2,
      value: 'lock-b',
    });

    const firstUpdate = await clientA.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 20
      && message.data.col === 1
      && message.data.value === 'lock-a'
    ));
    const secondUpdate = await clientB.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 20
      && message.data.col === 2
      && message.data.value === 'lock-b'
    ));

    const finalDocRead = await getJson(serverB.baseUrl, '/docs/doc_sys_001');
    assert.equal(finalDocRead.status, 200);
    assert.notEqual(firstUpdate.data.seq, secondUpdate.data.seq);
    assert.equal(finalDocRead.json.data.currentSeq, Math.max(firstUpdate.data.seq, secondUpdate.data.seq));
    assert.ok(finalDocRead.json.data.currentSeq >= initialSeq + 1);
    assert.equal(getActiveSheetSnapshot(finalDocRead.json.data.snapshot).cells['20:1'].value, 'lock-a');
    assert.equal(getActiveSheetSnapshot(finalDocRead.json.data.snapshot).cells['20:2'].value, 'lock-b');
  } finally {
    await clientA.close();
    await clientB.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis OT rebases stale baseSeq set_cell across instances on the same cell', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'redis-ot-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'redis-ot-b' });
  const clientA = await connect(serverA.wsUrl);
  const clientB = await connect(serverB.wsUrl);

  try {
    const joinAckA = await joinRoom(clientA, 'doc_sys_001', 'ot-user-a');
    const joinAckB = await joinRoom(clientB, 'doc_sys_001', 'ot-user-b');
    const sharedBaseSeq = Math.min(joinAckA.data.currentSeq, joinAckB.data.currentSeq);

    clientA.send({
      type: 'set_cell',
      sheetId: DEFAULT_SHEET_ID,
      docId: 'doc_sys_001',
      clientId: 'ot-user-a',
      row: 30,
      col: 1,
      value: 'ot-first',
      baseSeq: sharedBaseSeq,
    });
    await clientA.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 30
      && message.data.col === 1
      && message.data.value === 'ot-first'
    ));

    clientB.send({
      type: 'set_cell',
      sheetId: DEFAULT_SHEET_ID,
      docId: 'doc_sys_001',
      clientId: 'ot-user-b',
      row: 30,
      col: 1,
      value: 'ot-second',
      baseSeq: sharedBaseSeq,
    });
    const rebasedReply = await clientB.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 30
      && message.data.col === 1
      && message.data.value === 'ot-second'
    ));

    assert.equal('baseSeq' in rebasedReply.data, false);
    assert.equal('rebased' in rebasedReply.data, false);

    const finalDocRead = await getJson(serverA.baseUrl, '/docs/doc_sys_001');
    assert.equal(finalDocRead.status, 200);
    assert.equal(getActiveSheetSnapshot(finalDocRead.json.data.snapshot).cells['30:1'].value, 'ot-second');
  } finally {
    await clientA.close();
    await clientB.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('docsService ignores mixed live seq and snapshot cache entries', async () => {
  const docsService = require('../service/docsService');
  const docSnapshotCache = require('../cache/docSnapshotCache');
  const docStateCache = require('../cache/docStateCache');

  const freshDoc = await docsService.getDocState('doc_sys_001');
  const staleSnapshot = JSON.parse(JSON.stringify(freshDoc));

  await docSnapshotCache.set('doc_sys_001', staleSnapshot);
  await docStateCache.set('doc_sys_001', { currentSeq: staleSnapshot.currentSeq + 1 });

  const reloadedDoc = await docsService.getDocState('doc_sys_001');
  const cachedSnapshot = await docSnapshotCache.get('doc_sys_001');

  assert.equal(reloadedDoc.currentSeq, freshDoc.currentSeq);
  assert.deepEqual(reloadedDoc.snapshot, freshDoc.snapshot);
  assert.deepEqual(cachedSnapshot, reloadedDoc);
});

test('set_cell retries once after atomic commit seq mismatch and then succeeds', async () => {
  const restoreEnv = (key, value) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  };
  const originalEnv = {
    STORE_DRIVER: process.env.STORE_DRIVER,
    CACHE_DRIVER: process.env.CACHE_DRIVER,
    RUNTIME_STATE_DRIVER: process.env.RUNTIME_STATE_DRIVER,
    DOC_LOCK_DRIVER: process.env.DOC_LOCK_DRIVER,
  };

  process.env.STORE_DRIVER = 'mysql';
  process.env.CACHE_DRIVER = 'redis';
  process.env.RUNTIME_STATE_DRIVER = 'redis';
  process.env.DOC_LOCK_DRIVER = 'redis';

  await closeProjectResources();
  clearBackendRequireCache();
  await resetMysqlDatabase({
    closePoolAfterReset: false,
    silent: true,
  });
  await resetRedisTestKeys();

  const atomicCommitModule = require('../infra/redis/setCellAtomicCommit');
  const originalCommit = atomicCommitModule.commitSetCellAtomically;
  let commitAttempts = 0;

  atomicCommitModule.commitSetCellAtomically = async (payload) => {
    commitAttempts += 1;
    if (commitAttempts === 1) {
      throw new Error('SEQ_MISMATCH');
    }
    return originalCommit(payload);
  };

  try {
    const cellService = require('../service/cellService');
    const docsService = require('../service/docsService');

    const result = await cellService.applySetCell({
      docId: 'doc_sys_001',
      clientId: 'redis-retry-user',
      sheetId: DEFAULT_SHEET_ID,
      row: 41,
      col: 2,
      value: 'retry-once-success',
    });

    assert.equal(result.row, 41);
    assert.equal(result.col, 2);
    assert.equal(result.value, 'retry-once-success');
    assert.equal(commitAttempts, 2);

    const docState = await docsService.getDocState('doc_sys_001');
    assert.equal(getActiveSheetSnapshot(docState.snapshot).cells['41:2'].value, 'retry-once-success');
  } finally {
    atomicCommitModule.commitSetCellAtomically = originalCommit;
    await closeProjectResources();
    restoreEnv('STORE_DRIVER', originalEnv.STORE_DRIVER);
    restoreEnv('CACHE_DRIVER', originalEnv.CACHE_DRIVER);
    restoreEnv('RUNTIME_STATE_DRIVER', originalEnv.RUNTIME_STATE_DRIVER);
    restoreEnv('DOC_LOCK_DRIVER', originalEnv.DOC_LOCK_DRIVER);
    clearBackendRequireCache();
  }
});

test('redis atomic set_cell also persists user_op_state to mysql', async () => {
  const portA = await getFreePort();
  const serverA = await startServerInstance({ port: portA, serverId: 'redis-user-op-persist-a' });
  const clientA = await connect(serverA.wsUrl);

  try {
    await joinRoom(clientA, 'doc_sys_001', 'redis-user-op-persist-user');

    clientA.send({
      type: 'set_cell',
      sheetId: DEFAULT_SHEET_ID,
      docId: 'doc_sys_001',
      clientId: 'redis-user-op-persist-user',
      row: 40,
      col: 2,
      value: 'persist-user-op-state',
    });

    await clientA.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 40
      && message.data.col === 2
      && message.data.value === 'persist-user-op-state'
    ));

    const userOpStateMysqlStore = require('../store/mysql/userOpStateMysqlStore')();
    await waitForAsync(async () => {
      const persistedState = await userOpStateMysqlStore.getState('doc_sys_001', 'redis-user-op-persist-user');
      assert.ok(persistedState);
      assert.equal(persistedState.redoStackJson.length, 0);
      assert.equal(persistedState.undoStackJson.length, 1);
      assert.equal(persistedState.undoStackJson[0].opType, 'set_cell');
      assert.equal(persistedState.undoStackJson[0].row, 40);
      assert.equal(persistedState.undoStackJson[0].col, 2);
      assert.equal(persistedState.undoStackJson[0].newValue, 'persist-user-op-state');
    });
  } finally {
    await clientA.close();
    await serverA.stop();
  }
});

test('redis OT rebases stale baseSeq set_title across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'redis-title-ot-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'redis-title-ot-b' });
  const clientA = await connect(serverA.wsUrl);
  const clientB = await connect(serverB.wsUrl);

  try {
    const joinAckA = await joinRoom(clientA, 'doc_sys_001', 'title-ot-a');
    const joinAckB = await joinRoom(clientB, 'doc_sys_001', 'title-ot-b');
    const sharedBaseSeq = Math.min(joinAckA.data.currentSeq, joinAckB.data.currentSeq);

    clientA.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'title-ot-a',
      title: 'redis-title-first',
      baseSeq: sharedBaseSeq,
    });
    await clientA.waitFor((message) => (
      message.type === 'title_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.title === 'redis-title-first'
    ));

    clientB.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'title-ot-b',
      title: 'redis-title-second',
      baseSeq: sharedBaseSeq,
    });
    const rebasedReply = await clientB.waitFor((message) => (
      message.type === 'title_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.title === 'redis-title-second'
    ));

    assert.equal('baseSeq' in rebasedReply.data, false);
    assert.equal('rebased' in rebasedReply.data, false);

    const finalDocRead = await getJson(serverA.baseUrl, '/docs/doc_sys_001');
    assert.equal(finalDocRead.status, 200);
    assert.equal(finalDocRead.json.data.title, 'redis-title-second');
  } finally {
    await clientA.close();
    await clientB.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis OT turns stale undo and redo on the same cell into noop across instances', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'redis-undo-redo-ot-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'redis-undo-redo-ot-b' });
  const clientA = await connect(serverA.wsUrl);
  const clientB = await connect(serverB.wsUrl);

  try {
    await joinRoom(clientA, 'doc_sys_001', 'undo-redo-ot-a');
    await joinRoom(clientB, 'doc_sys_001', 'undo-redo-ot-b');

    clientA.send({
      type: 'set_cell',
      sheetId: DEFAULT_SHEET_ID,
      docId: 'doc_sys_001',
      clientId: 'undo-redo-ot-a',
      row: 31,
      col: 2,
      value: 'owner-first',
    });
    await clientA.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 31
      && message.data.col === 2
      && message.data.value === 'owner-first'
    ));

    clientB.send({
      type: 'set_cell',
      sheetId: DEFAULT_SHEET_ID,
      docId: 'doc_sys_001',
      clientId: 'undo-redo-ot-b',
      row: 31,
      col: 2,
      value: 'other-latest',
    });
    await clientB.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 31
      && message.data.col === 2
      && message.data.value === 'other-latest'
    ));

    clientA.send({
      type: 'undo',
      docId: 'doc_sys_001',
      clientId: 'undo-redo-ot-a',
    });
    const undoReply = await clientA.waitFor((message) => (
      message.type === 'undo_applied'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 31
      && message.data.col === 2
    ));
    assert.equal(undoReply.data.value, 'other-latest');
    assert.equal('rebased' in undoReply.data, false);
    assert.equal('noop' in undoReply.data, false);

    clientA.send({
      type: 'redo',
      docId: 'doc_sys_001',
      clientId: 'undo-redo-ot-a',
    });
    const redoReply = await clientA.waitFor((message) => (
      message.type === 'redo_applied'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 31
      && message.data.col === 2
    ));
    assert.equal(redoReply.data.value, 'other-latest');
    assert.equal('noop' in redoReply.data, false);

    const finalDocRead = await getJson(serverA.baseUrl, '/docs/doc_sys_001');
    assert.equal(finalDocRead.status, 200);
    assert.equal(getActiveSheetSnapshot(finalDocRead.json.data.snapshot).cells['31:2'].value, 'other-latest');
  } finally {
    await clientA.close();
    await clientB.close();
    await serverA.stop();
    await serverB.stop();
  }
});

test('redis cache keeps doc snapshot fresh across instances after set_cell undo redo and import_sheet', async () => {
  const portA = await getFreePort();
  const portB = await getFreePort();

  const serverA = await startServerInstance({ port: portA, serverId: 'cache-redis-ops-a' });
  const serverB = await startServerInstance({ port: portB, serverId: 'cache-redis-ops-b' });
  const editor = await connect(serverA.wsUrl);
  const observer = await connect(serverB.wsUrl);

  try {
    const initialDocRead = await getJson(serverB.baseUrl, '/docs/doc_sys_001');
    assert.equal(initialDocRead.status, 200);

    editor.send({ type: 'join', docId: 'doc_sys_001', clientId: 'cache-ops-editor' });
    await editor.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'cache-ops-editor');

    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'cache-ops-observer' });
    await observer.waitFor((message) => message.type === 'join_ack' && message.data.clientId === 'cache-ops-observer');

    editor.send({
      type: 'set_cell',
      sheetId: DEFAULT_SHEET_ID,
      docId: 'doc_sys_001',
      clientId: 'cache-ops-editor',
      row: 12,
      col: 3,
      value: 'redis-cache-cell',
    });
    await observer.waitFor((message) => (
      message.type === 'cell_updated'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 12
      && message.data.col === 3
      && message.data.value === 'redis-cache-cell'
    ));

    const afterSetCellRead = await getJson(serverB.baseUrl, '/docs/doc_sys_001');
    assert.equal(afterSetCellRead.status, 200);
    assert.equal(getActiveSheetSnapshot(afterSetCellRead.json.data.snapshot).cells['12:3'].value, 'redis-cache-cell');

    editor.send({
      type: 'undo',
      docId: 'doc_sys_001',
      clientId: 'cache-ops-editor',
    });
    await observer.waitFor((message) => (
      message.type === 'undo_applied'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 12
      && message.data.col === 3
      && message.data.value === ''
    ));

    const afterUndoRead = await getJson(serverB.baseUrl, '/docs/doc_sys_001');
    assert.equal(afterUndoRead.status, 200);
    assert.equal(getActiveSheetSnapshot(afterUndoRead.json.data.snapshot).cells['12:3'].value, '');

    editor.send({
      type: 'redo',
      docId: 'doc_sys_001',
      clientId: 'cache-ops-editor',
    });
    await observer.waitFor((message) => (
      message.type === 'redo_applied'
      && message.data.docId === 'doc_sys_001'
      && message.data.row === 12
      && message.data.col === 3
      && message.data.value === 'redis-cache-cell'
    ));

    const afterRedoRead = await getJson(serverB.baseUrl, '/docs/doc_sys_001');
    assert.equal(afterRedoRead.status, 200);
    assert.equal(getActiveSheetSnapshot(afterRedoRead.json.data.snapshot).cells['12:3'].value, 'redis-cache-cell');

    editor.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'cache-ops-editor',
      snapshot: {
        id: 'sheet_doc_sys_001_cache_import',
        name: 'CacheImported',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '2:2': {
            row: 2,
            col: 2,
            value: 'imported-from-redis-cache-test',
            styleId: null,
          },
        },
        styles: {},
        rowCount: 2,
        colCount: 2,
      },
    });
    await observer.waitFor((message) => (
      message.type === 'sheet_imported'
      && message.data.docId === 'doc_sys_001'
      && message.data.snapshot
      && getActiveSheetSnapshot(message.data.snapshot)
      && getActiveSheetSnapshot(message.data.snapshot).cells['2:2']
      && getActiveSheetSnapshot(message.data.snapshot).cells['2:2'].value === 'imported-from-redis-cache-test'
    ));

    const afterImportRead = await getJson(serverB.baseUrl, '/docs/doc_sys_001');
    assert.equal(afterImportRead.status, 200);
    assert.equal(getActiveSheetSnapshot(afterImportRead.json.data.snapshot).cells['2:2'].value, 'imported-from-redis-cache-test');
    assert.equal(getActiveSheetSnapshot(afterImportRead.json.data.snapshot).cells['12:3'], undefined);
  } finally {
    await editor.close();
    await observer.close();
    await serverA.stop();
    await serverB.stop();
  }
});
