'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const WebSocket = require('ws');
const { resetMysqlDatabase } = require('../scripts/dbReset');

const projectRoot = path.resolve(__dirname, '..');

async function resetTestStore() {
  if (process.env.STORE_DRIVER !== 'mysql') {
    return;
  }

  await resetMysqlDatabase({
    closePoolAfterReset: false,
    silent: true,
  });
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

async function closeProjectResources() {
  const cacheModulePath = path.join(projectRoot, 'cache', 'index.js');
  const roomServiceModulePath = path.join(projectRoot, 'service', 'roomService.js');
  const idempotencyServiceModulePath = path.join(projectRoot, 'idempotency', 'idempotencyService.js');
  const lockModulePath = path.join(projectRoot, 'infra', 'redis', 'lock.js');

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
}

// ==================== 基础设施 ====================

function clearBackendRequireCache() {
  for (const key of Object.keys(require.cache)) {
    const keepMysqlModules = process.env.STORE_DRIVER === 'mysql'
      && key.includes(`${path.sep}db${path.sep}mysql${path.sep}`);

    if (
      key.startsWith(projectRoot) &&
      !key.includes(`${path.sep}node_modules${path.sep}`) &&
      !keepMysqlModules &&
      key !== __filename
    ) {
      delete require.cache[key];
    }
  }
}

test.beforeEach(async () => {
  await resetTestStore();
  await closeProjectResources();
  clearBackendRequireCache();
});

test.after(async () => {
  await closeProjectResources();
  await teardownTestStore();
  clearBackendRequireCache();
});

async function createTestServer() {
  const app = require('../app');
  const { createWebSocketServer } = require('../ws');

  const server = http.createServer(app);
  const wss = createWebSocketServer(server);
  server.listen(0);
  await once(server, 'listening');
  if (wss.ready && typeof wss.ready.then === 'function') {
    await wss.ready;
  }

  const { port } = server.address();
  return {
    wsUrl: `ws://127.0.0.1:${port}`,
    server,
    async close() {
      if (typeof wss.shutdown === 'function') {
        await wss.shutdown();
      } else {
        await new Promise((resolve) => {
          wss.close(() => resolve());
        });
      }
      server.close();
      await Promise.race([
        once(server, 'close').catch(() => {}),
        new Promise((r) => setTimeout(r, 500)),
      ]);
    },
  };
}

// 建立 WS 连接。waitFor(n) 轮询式，每 5ms 检查一次，3000ms 超时即 reject。
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await once(ws, 'open');

  const received = [];

  ws.on('message', (raw) => {
    received.push(JSON.parse(raw.toString()));
  });

  function waitFor(n, ms = 3000) {
    if (received.length >= n) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        if (received.length >= n) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - start >= ms) {
          clearInterval(iv);
          reject(new Error(`waitFor(${n}) timeout — got ${received.length}`));
        }
      }, 5);
    });
  }

  // 确认在 ms 内没有新消息到达
  function noMoreFor(ms = 150) {
    const before = received.length;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (received.length > before) {
          reject(new Error(`unexpected message received (got ${received.length - before} more)`));
        } else {
          resolve();
        }
      }, ms);
    });
  }

  async function close() {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
      await once(ws, 'close').catch(() => {});
    }
  }

  return { ws, received, send: (m) => ws.send(JSON.stringify(m)), waitFor, noMoreFor, close };
}

async function joinDoc(client, docId, clientId, extra = {}) {
  const base = client.received.length;
  client.send({
    type: 'join',
    docId,
    clientId,
    ...extra,
  });
  await client.waitFor(base + 2);
  return client.received[base];
}

async function waitForCondition(check, { timeoutMs = 1000, intervalMs = 20 } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

function assertSnapshotMatchesDocFormat(snapshot, expected) {
  assert.equal(typeof snapshot, 'object');
  assert.equal(snapshot.id, expected.id);
  assert.equal(snapshot.name, expected.name);
  assert.equal(snapshot.defaultRowHeight, expected.defaultRowHeight);
  assert.equal(snapshot.defaultColWidth, expected.defaultColWidth);
  assert.equal(snapshot.rowCount, expected.rowCount);
  assert.equal(snapshot.colCount, expected.colCount);
  assert.deepEqual(snapshot.styles, expected.styles);
  assert.deepEqual(snapshot.cells, expected.cells);
}

// ==================== join — 基础成功路径 ====================

test('join: join_ack 包含 snapshot 和 users', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1', name: 'Alice', color: '#ff0000' });
    await c.waitFor(1);

    const ack = c.received[0];
    assert.equal(ack.type, 'join_ack');
    assert.equal(ack.code, 0);
    assert.equal(ack.message, 'ok');
    assert.equal(ack.data.docId, 'doc_sys_001');
    assert.equal(ack.data.clientId, 'u1');
    assert.equal(typeof ack.data.currentSeq, 'number');
    assert.ok(ack.data.snapshot && typeof ack.data.snapshot === 'object');
    assert.ok(Array.isArray(ack.data.users));
    assert.equal(ack.data.users.length, 1);
    const user = ack.data.users[0];
    assert.equal(user.clientId, 'u1');
    assert.equal(user.name, 'Alice');
    assert.equal(user.color, '#ff0000');
    assert.equal(user.status, 'online');
    assert.equal(user.docId, 'doc_sys_001');
    assert.ok(user.joinedAt);
    assert.ok(user.lastActiveAt);
    assert.equal(typeof user.id, 'number');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 种子文档 doc_sys_001 快照正确', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(1);

    const snap = c.received[0].data.snapshot;
    assert.equal(snap.id, 'sheet_20260527_001');
    assert.equal(snap.name, '2026年销售数据表');
    assert.equal(snap.defaultRowHeight, 25);
    assert.equal(snap.defaultColWidth, 100);
    assert.equal(snap.rowCount, 100);
    assert.equal(snap.colCount, 26);
    assert.equal(snap.cells['0:0'].value, '产品名称');
    assert.equal(snap.cells['0:0'].row, 0);
    assert.equal(snap.cells['0:0'].col, 0);
    assert.equal(snap.cells['0:0'].styleId, 'style_header');
    assert.equal(snap.cells['0:1'].value, '销售金额');
    assert.equal(snap.cells['1:1'].value, '9999.00');
    assert.equal(snap.cells['1:1'].styleId, 'style_currency');
    assert.deepEqual(snap.styles.style_header, {
      fontFamily: '微软雅黑',
      fontSize: 14,
      bold: true,
      color: '#FFFFFF',
      bgColor: '#4472C4',
      hAlign: 'center',
    });
  } finally {
    await c.close();
    await srv.close();
  }
});

// ==================== join — name/color 缺省回退 ====================

test('join: name/color 未传时回退默认值', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(1);
    const user = c.received[0].data.users[0];
    assert.equal(user.name, '');
    assert.equal(user.color, '#3b82f6');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: name 非字符串时回退空字符串，color 为 null 时回退默认色', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1', name: 123, color: null });
    await c.waitFor(1);
    const user = c.received[0].data.users[0];
    assert.equal(user.name, '');
    assert.equal(user.color, '#3b82f6');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: color 为空字符串时回退默认色', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1', color: '' });
    await c.waitFor(1);
    assert.equal(c.received[0].data.users[0].color, '#3b82f6');
  } finally {
    await c.close();
    await srv.close();
  }
});

// ==================== join — 参数校验 ====================

test('join: 缺少 docId 返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', clientId: 'u1' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.equal(c.received[0].message, 'docId and clientId are required');
    assert.equal(c.received[0].data, null);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 缺少 clientId 返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.equal(c.received[0].message, 'docId and clientId are required');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 文档不存在返回 4004', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_nonexistent', clientId: 'u1' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4004);
    assert.match(c.received[0].message, /document not found: doc_nonexistent/);
    assert.equal(c.received[0].data, null);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 并发重复 join 首次失败 — 等待中的请求收到相同 error 而非静默吞掉', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    // 两条并发 join，文档不存在 → 首条走失败分支
    c.send({ type: 'join', docId: 'doc_nonexistent', clientId: 'u1' });
    c.send({ type: 'join', docId: 'doc_nonexistent', clientId: 'u1' });

    await new Promise((r) => setTimeout(r, 300));

    const errors = c.received.filter((m) => m.type === 'error' && m.code === 4004);
    assert.ok(errors.length >= 2, `both concurrent joins should receive 4004, got ${c.received.length} messages`);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 并发重复 join 在 joinRoom 后置阶段失败时，仍返回 join_ack 而非反向打成失败', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  const roomService = require('../service/roomService');
  const originalGetRoomUsers = roomService.getRoomUsers;
  roomService.getRoomUsers = async () => {
    throw new Error('presence unavailable');
  };

  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });

    await new Promise((r) => setTimeout(r, 300));

    const joinAcks = c.received.filter((m) => m.type === 'join_ack');
    assert.ok(joinAcks.length >= 2, `both concurrent joins should receive join_ack, got ${JSON.stringify(c.received)}`);
    assert.ok(joinAcks.every((m) => m.code === 0));
    assert.ok(joinAcks.every((m) => Array.isArray(m.data.users)));
    assert.equal(c.received.filter((m) => m.type === 'error').length, 0);
  } finally {
    roomService.getRoomUsers = originalGetRoomUsers;
    await c.close();
    await srv.close();
  }
});

test('join: join_ack 发出后 audit 失败不再补发 500', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  const auditService = require('../audit/auditService');
  const originalRecord = auditService.recordAuditEvent;
  auditService.recordAuditEvent = async () => {
    throw new Error('audit unavailable');
  };

  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);
    await c.noMoreFor(150);

    assert.equal(c.received[0].type, 'join_ack');
    assert.equal(c.received[1].type, 'presence');
    assert.equal(c.received.filter((m) => m.type === 'error').length, 0);
  } finally {
    auditService.recordAuditEvent = originalRecord;
    await c.close();
    await srv.close();
  }
});

// ==================== join — presence 广播 ====================

test('join: 新 clientId 上线触发 presence 广播', async () => {
  const srv = await createTestServer();
  const c1 = await connect(srv.wsUrl);
  const c2 = await connect(srv.wsUrl);
  try {
    // c1 先加入：收 join_ack(1) + presence-self(1) = 2
    c1.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1', name: 'Alice', color: '#f00' });
    await c1.waitFor(2);
    assert.equal(c1.received[0].type, 'join_ack');
    assert.equal(c1.received[1].type, 'presence');

    // c2 加入：c2 收 join_ack(1)，c1 同时收到 presence 广播(1)
    c2.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2', name: 'Bob', color: '#0f0' });
    // 等 c1 和 c2 各自收齐
    await Promise.all([c1.waitFor(3), c2.waitFor(1)]);

    assert.equal(c2.received[0].type, 'join_ack');
    assert.equal(c2.received[0].data.users.length, 2);

    const lastPresence = c1.received[2];
    assert.equal(lastPresence.type, 'presence');
    assert.equal(lastPresence.data.users.length, 2);
    assert.ok(lastPresence.data.users.some((u) => u.clientId === 'u2'));
  } finally {
    await c1.close();
    await c2.close();
    await srv.close();
  }
});

test('join: 同 clientId 已在线不重复广播 presence', async () => {
  const srv = await createTestServer();
  const observer = await connect(srv.wsUrl);
  const c1 = await connect(srv.wsUrl);
  const c2 = await connect(srv.wsUrl);
  try {
    // observer 加入，收 join_ack + self-presence = 2
    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'obs' });
    await observer.waitFor(2);

    // c1 以 u1 加入：c1 收 join_ack + self-broadcast = 2，observer 收 u1-presence = 3
    c1.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await Promise.all([c1.waitFor(2), observer.waitFor(3)]);

    // c2 以相同 u1 加入：c2 收 join_ack，observer 不应再收 presence
    c2.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c2.waitFor(1);
    await observer.noMoreFor(100); // 不应有新消息
    assert.equal(observer.received.filter((m) => m.type === 'presence').length, 2); // obs自己 + u1上线
  } finally {
    await observer.close();
    await c1.close();
    await c2.close();
    await srv.close();
  }
});

// ==================== join — 同一 socket 重复 join（幂等） ====================

test('join: 同一 socket 重复 join，joinRoom 只执行一次', async () => {
  const srv = await createTestServer();
  const observer = await connect(srv.wsUrl);
  const c = await connect(srv.wsUrl);
  try {
    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'obs' });
    await observer.waitFor(2); // join_ack + self-presence

    // 连发两条 join（同一 socket 同一 docId）
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });

    // 第一条正常执行：c 收 join_ack + self-broadcast presence = 2 条
    // 第二条命中 PENDING，等待后补发相同 join_ack（不触发第二次 joinRoom）
    // observer：收 u1 上线 presence = 第 3 条
    await Promise.all([c.waitFor(3), observer.waitFor(3)]);

    assert.equal(c.received.filter((m) => m.type === 'join_ack').length, 2);
    assert.equal(c.received.filter((m) => m.type === 'presence').length, 1);

    await observer.noMoreFor(150); // 不应再有新消息
    assert.equal(observer.received.filter((m) => m.type === 'presence').length, 2); // self + u1
    assert.ok(
      observer.received.find((m) => m.type === 'presence' && m.data.users.some((u) => u.clientId === 'u1'))
    );
  } finally {
    await c.close();
    await observer.close();
    await srv.close();
  }
});

// ==================== join — disconnect 触发 presence 广播 ====================

test('join: 断开后房间其他人收到 presence，user 已移除', async () => {
  const srv = await createTestServer();
  const c1 = await connect(srv.wsUrl);
  const c2 = await connect(srv.wsUrl);
  try {
    // c1 先加入
    c1.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c1.waitFor(2); // join_ack + self-presence

    // c2 加入：c2 收 join_ack(1)，c1 同时收 presence(1)
    c2.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await Promise.all([c2.waitFor(1), c1.waitFor(3)]); // c2: ack, c1: ack+self-p+u2-p

    // c1 断开：c2 收 leave presence（最后一条 presence 的 users 只剩 u2）
    await c1.close();
    // c2 join 时自己也会收一条 presence 广播（isNewlyOnline），再加 leave 共 2 条 presence
    await c2.waitFor(3); // join_ack + join-self-presence + leave-presence
    const presences = c2.received.filter((m) => m.type === 'presence');
    const last = presences[presences.length - 1];
    assert.equal(last.data.users.length, 1);
    assert.equal(last.data.users[0].clientId, 'u2');
  } finally {
    await c2.close();
    await srv.close();
  }
});

test('join: 同 clientId 最后一个 socket 断开才广播 leave', async () => {
  const srv = await createTestServer();
  const c1a = await connect(srv.wsUrl);
  const c1b = await connect(srv.wsUrl);
  const c2 = await connect(srv.wsUrl);
  try {
    // c2 先加入
    c2.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await c2.waitFor(2); // join_ack + self-presence

    // c1a 以 u1 加入，c2 收 presence
    c1a.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await Promise.all([c1a.waitFor(1), c2.waitFor(3)]); // c1a: ack, c2: ack+self-p+u1-p

    // c1b 以同 u1 加入，c2 不应收新 presence
    c1b.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c1b.waitFor(1);
    await c2.noMoreFor(100);

    // c1a 断开，u1 仍有 c1b，c2 不应收 presence
    await c1a.close();
    await c2.noMoreFor(100);
    assert.equal(c2.received.length, 3); // 只有 join_ack + self-presence + u1上线

    // c1b 断开，u1 完全下线，c2 应收 leave presence
    await c1b.close();
    await c2.waitFor(4); // +1 leave presence

    const leavePresence = c2.received[3];
    assert.equal(leavePresence.type, 'presence');
    assert.ok(!leavePresence.data.users.some((u) => u.clientId === 'u1'));
    assert.ok(leavePresence.data.users.some((u) => u.clientId === 'u2'));
  } finally {
    await c2.close();
    await srv.close();
  }
});

test('leave: 用户 fully offline 时清理 userOpState', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u_cleanup' });
    await c.waitFor(2);
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u_cleanup', row: 1, col: 1, value: 'cleanup-me', style: null });
    await c.waitFor(4);

    const userOpStateStore = require('../store/userOpStateStore');
    const beforeClose = await userOpStateStore.getState('doc_sys_001', 'u_cleanup');
    assert.ok(beforeClose);
    assert.equal(beforeClose.undoStackJson.length, 1);

    await c.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const afterClose = await userOpStateStore.getState('doc_sys_001', 'u_cleanup');
    assert.equal(afterClose, null);
  } finally {
    await srv.close();
  }
});

test('join: 同一 socket 切换 clientId 不命中幂等，视为新 join', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2); // join_ack + self-presence

    // 同一 socket，相同 docId，但不同 clientId → key 不同，不走幂等分支
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await c.waitFor(4); // 再收 join_ack + presence

    const acks = c.received.filter((m) => m.type === 'join_ack');
    assert.equal(acks.length, 2);
    assert.equal(acks[0].data.clientId, 'u1');
    assert.equal(acks[1].data.clientId, 'u2');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 同一 socket 切换文档后 close，旧房间无残留连接', async () => {
  const srv = await createTestServer();
  const { createDoc } = require('../service/docsService');
  const docB = await createDoc({ title: 'DocB' });

  const c = await connect(srv.wsUrl);
  const observer = await connect(srv.wsUrl);
  try {
    // observer 加入 doc_sys_001
    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'obs' });
    await observer.waitFor(2);

    // c 先加入 doc_sys_001，然后切到 docB
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await Promise.all([c.waitFor(2), observer.waitFor(3)]);

    // c 切到 docB：u1 在 doc_sys_001 完全下线，observer 收到 u1-leave presence
    c.send({ type: 'join', docId: docB.docId, clientId: 'u1' });
    await Promise.all([c.waitFor(4), observer.waitFor(4)]); // observer 收 self+u1上线+u1下线

    const obsPresences = observer.received.filter((m) => m.type === 'presence');
    const lastObsPresence = obsPresences[obsPresences.length - 1];
    assert.ok(!lastObsPresence.data.users.some((u) => u.clientId === 'u1'), 'u1 should be gone after room switch');

    // c 断开 → 只触发 docB 的 leave，doc_sys_001 的 observer 不应再收到新消息
    await c.close();
    await observer.noMoreFor(200);
    assert.equal(observer.received.length, 4);
  } finally {
    await observer.close();
    await srv.close();
  }
});

test('join: 同一 socket 切换文档后再次 join 旧文档，正常重新入房', async () => {
  const srv = await createTestServer();
  const { createDoc } = require('../service/docsService');
  const docB = await createDoc({ title: 'DocB-rejoin' });

  const c = await connect(srv.wsUrl);
  try {
    // 加入 doc_sys_001
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);

    // 切到 docB
    c.send({ type: 'join', docId: docB.docId, clientId: 'u1' });
    await c.waitFor(4);

    // 再切回 doc_sys_001：不应命中幂等缓存（key 已在成功后被清除），应重新执行 joinRoom
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(6);

    const acks = c.received.filter((m) => m.type === 'join_ack');
    assert.equal(acks.length, 3);
    assert.equal(acks[2].data.docId, 'doc_sys_001');
    assert.equal(acks[2].data.clientId, 'u1');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 同一 socket 切换文档导致旧房间 fully offline 时清理 userOpState', async () => {
  const srv = await createTestServer();
  const { createDoc } = require('../service/docsService');
  const docB = await createDoc({ title: 'DocB-cleanup' });
  const c = await connect(srv.wsUrl);

  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u_switch_cleanup' });
    await c.waitFor(2);
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u_switch_cleanup', row: 2, col: 2, value: 'cleanup-on-switch', style: null });
    await c.waitFor(4);

    const userOpStateStore = require('../store/userOpStateStore');
    const beforeSwitch = await userOpStateStore.getState('doc_sys_001', 'u_switch_cleanup');
    assert.ok(beforeSwitch);
    assert.equal(beforeSwitch.undoStackJson.length, 1);

    c.send({ type: 'join', docId: docB.docId, clientId: 'u_switch_cleanup' });
    await c.waitFor(5);

    const afterSwitch = await userOpStateStore.getState('doc_sys_001', 'u_switch_cleanup');
    assert.equal(afterSwitch, null);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 同一 socket 切换 clientId 后旧 clientId 从在线列表消失', async () => {
  const srv = await createTestServer();
  const observer = await connect(srv.wsUrl);
  const c = await connect(srv.wsUrl);
  try {
    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'obs' });
    await observer.waitFor(2);

    // c 以 u1 加入，observer 收 presence
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await Promise.all([c.waitFor(2), observer.waitFor(3)]);

    // c 切换 clientId 到 u2（同 doc）：u1 应该离线，u2 上线
    // 同文档切换时，leave 和 join 的 presence 列表相同，只广播一次
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await Promise.all([c.waitFor(4), observer.waitFor(4)]); // c: +join_ack+presence, observer: +1条 presence（u1-leave/u2-online 合并）

    // observer 最后收到的 presence 中不应有 u1
    const presences = observer.received.filter((m) => m.type === 'presence');
    const last = presences[presences.length - 1];
    assert.ok(!last.data.users.some((u) => u.clientId === 'u1'), 'u1 should be gone after clientId switch');
    assert.ok(last.data.users.some((u) => u.clientId === 'u2'), 'u2 should be online');
  } finally {
    await c.close();
    await observer.close();
    await srv.close();
  }
});

test('join: docId 为数字类型返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 123, clientId: 'u1' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.match(c.received[0].message, /required/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: clientId 为空字符串返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: '' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.match(c.received[0].message, /required/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('presence: docId 为数字类型返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'presence', docId: 456 });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.match(c.received[0].message, /required/);
  } finally {
    await c.close();
    await srv.close();
  }
});

// ==================== join — audit ====================

test('join: 写入 audit 日志', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u_audit' });
    await c.waitFor(1);
    await new Promise((r) => setImmediate(r));

    const auditLogStore = require('../store/auditLogStore');
    const logs = await auditLogStore.listByEventType('join');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].docId, 'doc_sys_001');
    assert.equal(logs[0].clientId, 'u_audit');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: 同一 socket 重复 join 只写一条 audit', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);
    await new Promise((r) => setImmediate(r));

    const auditLogStore = require('../store/auditLogStore');
    assert.equal((await auditLogStore.listByEventType('join')).length, 1);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('leave: clientId 完全断开写入 leave audit', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u_leave' });
    await c.waitFor(1);
    await c.close();

    const auditLogStore = require('../store/auditLogStore');
    const logs = await waitForCondition(async () => {
      const rows = await auditLogStore.listByEventType('leave');
      return rows.length > 0 ? rows : null;
    });

    assert.ok(logs);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].clientId, 'u_leave');
    assert.equal(logs[0].docId, 'doc_sys_001');
  } finally {
    await srv.close();
  }
});

// ==================== presence ====================

test('presence: 发送方收 2 条，其他成员收 1 条', async () => {
  const srv = await createTestServer();
  const sender = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    // 顺序 join 确保消息数精确
    sender.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u_sender' });
    await sender.waitFor(2); // join_ack + self-presence
    other.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u_other' });
    await other.waitFor(1); // join_ack
    await sender.waitFor(3); // +1 other上线presence

    const baseSender = sender.received.length; // 3
    const baseOther = other.received.length;   // 1

    sender.send({ type: 'presence', docId: 'doc_sys_001' });
    // sender: reply(1) + broadcastToRoom(1) = 2 新增
    await sender.waitFor(baseSender + 2);
    // other:  broadcastToRoom(1) = 1 新增
    await other.waitFor(baseOther + 1);

    const newSender = sender.received.slice(baseSender).filter((m) => m.type === 'presence');
    const newOther = other.received.slice(baseOther).filter((m) => m.type === 'presence');
    assert.equal(newSender.length, 2);
    assert.equal(newOther.length, 1);

    const p = newSender[0];
    assert.equal(p.code, 0);
    assert.equal(p.message, 'ok');
    assert.equal(p.data.docId, 'doc_sys_001');
    assert.equal(p.data.users.length, 2);
  } finally {
    await sender.close();
    await other.close();
    await srv.close();
  }
});

test('presence: 未 join 的 socket 返回 4003', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'presence', docId: 'doc_sys_001' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4003);
    assert.match(c.received[0].message, /not joined/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('presence: join 后查询不存在的 docId 返回 4003（未入房）', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);
    c.send({ type: 'presence', docId: 'doc_ghost' });
    await c.waitFor(3);
    assert.equal(c.received[2].type, 'error');
    assert.equal(c.received[2].code, 4003);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('presence: 缺少 docId 返回 error 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'presence' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.equal(c.received[0].message, 'docId is required');
    assert.equal(c.received[0].data, null);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('presence: users 包含完整用户对象结构', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1', name: 'Test', color: '#aabbcc' });
    await c.waitFor(2); // join_ack + self-presence
    const base = c.received.length;

    c.send({ type: 'presence', docId: 'doc_sys_001' });
    await c.waitFor(base + 2); // reply + broadcastToRoom(自己在房间)

    const user = c.received[base].data.users[0];
    assert.equal(typeof user.id, 'number');
    assert.equal(user.docId, 'doc_sys_001');
    assert.equal(user.clientId, 'u1');
    assert.equal(user.name, 'Test');
    assert.equal(user.color, '#aabbcc');
    assert.equal(user.status, 'online');
    assert.ok(user.joinedAt);
    assert.ok(user.lastActiveAt);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('presence: 写入 audit 日志', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u_pres_audit' });
    await c.waitFor(2); // join_ack + self-presence
    const base = c.received.length;

    c.send({ type: 'presence', docId: 'doc_sys_001' });
    await c.waitFor(base + 2); // reply + broadcast
    const auditLogStore = require('../store/auditLogStore');
    const logs = await waitForCondition(async () => {
      const rows = await auditLogStore.listByEventType('presence');
      return rows.length > 0 ? rows : null;
    });
    assert.ok(logs);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].docId, 'doc_sys_001');
  } finally {
    await c.close();
    await srv.close();
  }
});

// ==================== 通用 WS 错误处理 ====================

test('ws: 非法 JSON 返回 error 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.ws.send('{ not valid json');
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.equal(c.received[0].message, 'Invalid JSON message');
    assert.equal(c.received[0].data, null);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('ws: JSON 数组返回 error 4000 Invalid WebSocket message', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.ws.send(JSON.stringify([1, 2, 3]));
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.equal(c.received[0].message, 'Invalid WebSocket message');
    assert.equal(c.received[0].data, null);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('ws: 不支持的消息类型返回 error 4001', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'unknown_type' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4001);
    assert.equal(c.received[0].message, 'Unsupported message type');
    assert.equal(c.received[0].data, null);
  } finally {
    await c.close();
    await srv.close();
  }
});

// ==================== set_cell ====================

// ==================== set_title ====================

test('set_title: 返回 title_updated，data 字段结构完整', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    c.send({ type: 'set_title', docId: 'doc_sys_001', clientId: 'u1', title: '新的文档标题' });
    await c.waitFor(3);
    const msg = c.received[2];
    assert.equal(msg.type, 'title_updated');
    assert.equal(msg.code, 0);
    assert.equal(msg.message, 'ok');
    assert.equal(msg.data.docId, 'doc_sys_001');
    assert.equal(msg.data.clientId, 'u1');
    assert.equal(typeof msg.data.seq, 'number');
    assert.ok(msg.data.seq >= 1);
    assert.equal(msg.data.title, '新的文档标题');
    assert.equal('canUndo' in msg.data, false);
    assert.equal('canRedo' in msg.data, false);

    const { getDocState } = require('../service/docsService');
    const docState = await getDocState('doc_sys_001');
    assert.equal(docState.title, '新的文档标题');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_title: title 会自动 trim', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    c.send({ type: 'set_title', docId: 'doc_sys_001', clientId: 'u1', title: '  标题已修正  ' });
    await c.waitFor(3);
    assert.equal(c.received[2].data.title, '标题已修正');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_title: 显式 baseSeq 会写入 history', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    const joinAck = await joinDoc(c, 'doc_sys_001', 'u_title_base_seq');
    const baseSeq = joinAck.data.currentSeq;
    const base = c.received.length;

    c.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'u_title_base_seq',
      title: 'title-base-seq',
      baseSeq,
    });
    await c.waitFor(base + 2);

    const reply = c.received[base];
    assert.equal(reply.type, 'title_updated');
    assert.equal('baseSeq' in reply.data, false);
    assert.equal('rebased' in reply.data, false);

    const historyStore = require('../store/historyStore');
    const entry = await historyStore.findByDocIdAndSeq('doc_sys_001', reply.data.seq);
    assert.equal(entry.baseSeq, baseSeq);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_title: stale baseSeq 会在最新标题上继续重放', async () => {
  const srv = await createTestServer();
  const owner = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    const joinAck = await joinDoc(owner, 'doc_sys_001', 'u_title_ot_owner');
    await joinDoc(other, 'doc_sys_001', 'u_title_ot_other');
    const sharedBaseSeq = joinAck.data.currentSeq;

    let ownerBase = owner.received.length;
    let otherBase = other.received.length;
    owner.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'u_title_ot_owner',
      title: 'first-title',
      baseSeq: sharedBaseSeq,
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    other.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'u_title_ot_other',
      title: 'second-title',
      baseSeq: sharedBaseSeq,
    });
    await Promise.all([
      owner.waitFor(ownerBase + 1),
      other.waitFor(otherBase + 2),
    ]);

    const reply = other.received[otherBase];
    assert.equal(reply.type, 'title_updated');
    assert.equal('baseSeq' in reply.data, false);
    assert.equal('rebased' in reply.data, false);
    assert.equal(reply.data.title, 'second-title');

    const { getDocState } = require('../service/docsService');
    const docState = await getDocState('doc_sys_001');
    assert.equal(docState.title, 'second-title');
  } finally {
    await owner.close();
    await other.close();
    await srv.close();
  }
});

test('set_title: stale baseSeq 在 import_sheet 之后仍可继续应用', async () => {
  const srv = await createTestServer();
  const owner = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    const joinAck = await joinDoc(owner, 'doc_sys_001', 'u_title_after_import');
    await joinDoc(other, 'doc_sys_001', 'u_title_import_other');
    const staleBaseSeq = joinAck.data.currentSeq;

    let ownerBase = owner.received.length;
    let otherBase = other.received.length;
    other.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'u_title_import_other',
      snapshot: {
        id: 'sheet_title_after_import',
        name: 'TitleAfterImport',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '1:1': { row: 1, col: 1, value: 'imported-title-test', styleId: null },
        },
        styles: {},
        rowCount: 1,
        colCount: 1,
      },
    });
    await Promise.all([
      owner.waitFor(ownerBase + 1),
      other.waitFor(otherBase + 2),
    ]);

    ownerBase = owner.received.length;
    owner.send({
      type: 'set_title',
      docId: 'doc_sys_001',
      clientId: 'u_title_after_import',
      title: 'title-after-import',
      baseSeq: staleBaseSeq,
    });
    await owner.waitFor(ownerBase + 2);

    const reply = owner.received[ownerBase];
    assert.equal(reply.type, 'title_updated');
    assert.equal('rebased' in reply.data, false);
    assert.equal(reply.data.title, 'title-after-import');
  } finally {
    await owner.close();
    await other.close();
    await srv.close();
  }
});

test('set_title: 发送方收 2 条（reply + broadcast），其他成员收 1 条', async () => {
  const srv = await createTestServer();
  const sender = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    sender.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await sender.waitFor(2);
    other.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await Promise.all([other.waitFor(2), sender.waitFor(3)]);

    const baseS = sender.received.length;
    const baseO = other.received.length;
    sender.send({ type: 'set_title', docId: 'doc_sys_001', clientId: 'u1', title: '广播标题' });
    await Promise.all([sender.waitFor(baseS + 2), other.waitFor(baseO + 1)]);

    const senderMsgs = sender.received.slice(baseS);
    const otherMsgs = other.received.slice(baseO);
    assert.equal(senderMsgs.filter((m) => m.type === 'title_updated').length, 2);
    assert.equal(otherMsgs.filter((m) => m.type === 'title_updated').length, 1);
    assert.deepEqual(senderMsgs[0].data, senderMsgs[1].data);
  } finally {
    await sender.close();
    await other.close();
    await srv.close();
  }
});

test('set_title: 缺少 docId/clientId 或 title 非法返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'set_title', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.match(c.received[0].message, /title must be a string/);

    c.send({ type: 'set_title', docId: 'doc_sys_001', clientId: '', title: 'x' });
    await c.waitFor(2);
    assert.equal(c.received[1].type, 'error');
    assert.equal(c.received[1].code, 4000);

    c.send({ type: 'set_title', docId: 'doc_sys_001', clientId: 'u1', title: '   ' });
    await c.waitFor(3);
    assert.equal(c.received[2].type, 'error');
    assert.equal(c.received[2].code, 4000);
    assert.match(c.received[2].message, /title must be a non-empty string/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_title: 未 join 或离开房间后返回 4003', async () => {
  const srv = await createTestServer();
  const outsider = await connect(srv.wsUrl);
  const owner = await connect(srv.wsUrl);
  try {
    outsider.send({ type: 'set_title', docId: 'doc_sys_001', clientId: 'u1', title: 'x' });
    await outsider.waitFor(1);
    assert.equal(outsider.received[0].type, 'error');
    assert.equal(outsider.received[0].code, 4003);

    const { createDoc } = require('../service/docsService');
    const docB = await createDoc({ title: 'title-switch-doc' });

    await joinDoc(owner, 'doc_sys_001', 'u1');
    owner.send({ type: 'join', docId: docB.docId, clientId: 'u1' });
    await owner.waitFor(4);

    owner.send({ type: 'set_title', docId: 'doc_sys_001', clientId: 'u1', title: 'should-fail' });
    await owner.waitFor(5);
    const last = owner.received.at(-1);
    assert.equal(last.type, 'error');
    assert.equal(last.code, 4003);
  } finally {
    await outsider.close();
    await owner.close();
    await srv.close();
  }
});

test('set_title: 写入 audit 日志', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u_title_audit');
    c.send({ type: 'set_title', docId: 'doc_sys_001', clientId: 'u_title_audit', title: '审计标题' });
    await c.waitFor(3);
    await new Promise((r) => setImmediate(r));
    const auditLogStore = require('../store/auditLogStore');
    const logs = await auditLogStore.listByEventType('set_title');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].docId, 'doc_sys_001');
    assert.equal(logs[0].clientId, 'u_title_audit');
    assert.equal(logs[0].payloadJson.title, '审计标题');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: 返回 cell_updated，data 字段结构完整', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: '姓名', style: { bold: true } });
    await c.waitFor(base + 2);
    const msg = c.received[base];
    assert.equal(msg.type, 'cell_updated');
    assert.equal(msg.code, 0);
    assert.equal(msg.message, 'ok');
    const d = msg.data;
    assert.equal(d.docId, 'doc_sys_001');
    assert.equal(d.clientId, 'u1');
    assert.equal(typeof d.seq, 'number');
    assert.ok(d.seq >= 1);
    assert.equal(d.row, 1);
    assert.equal(d.col, 1);
    assert.equal(d.value, '姓名');
    assert.deepEqual(d.style, { bold: true });
    assert.equal(d.canUndo, true);
    assert.equal(d.canRedo, false);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: value 未传时视为空字符串', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 2, col: 3 });
    await c.waitFor(base + 2);
    assert.equal(c.received[base].data.value, '');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: style 未传时为 null', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'x' });
    await c.waitFor(base + 2);
    assert.equal(c.received[base].data.style, null);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: seq 全文档单调递增', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'a' });
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 2, value: 'b' });
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 2, col: 1, value: 'c' });
    await c.waitFor(base + 6);
    const seqs = Array.from(new Set(c.received.slice(base).map((m) => m.data.seq)));
    assert.ok(seqs[1] > seqs[0], `seq not increasing: ${seqs}`);
    assert.ok(seqs[2] > seqs[1], `seq not increasing: ${seqs}`);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: 发送方收 2 条（reply + broadcast），其他成员收 1 条', async () => {
  const srv = await createTestServer();
  const sender = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    sender.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await sender.waitFor(2);
    other.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await Promise.all([other.waitFor(2), sender.waitFor(3)]);

    const baseS = sender.received.length;
    const baseO = other.received.length;
    sender.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'X' });
    await Promise.all([sender.waitFor(baseS + 2), other.waitFor(baseO + 1)]);

    const senderMsgs = sender.received.slice(baseS);
    const otherMsgs = other.received.slice(baseO);
    assert.equal(senderMsgs.filter((m) => m.type === 'cell_updated').length, 2);
    assert.equal(otherMsgs.filter((m) => m.type === 'cell_updated').length, 1);
    assert.deepEqual(senderMsgs[0].data, senderMsgs[1].data);
  } finally {
    await sender.close();
    await other.close();
    await srv.close();
  }
});

test('set_cell: 未 join 或离开房间后返回 4003', async () => {
  const srv = await createTestServer();
  const outsider = await connect(srv.wsUrl);
  const owner = await connect(srv.wsUrl);
  try {
    outsider.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u_out', row: 1, col: 1, value: 'out' });
    await outsider.waitFor(1);
    assert.equal(outsider.received[0].type, 'error');
    assert.equal(outsider.received[0].code, 4003);

    const { createDoc } = require('../service/docsService');
    const docB = await createDoc({ title: 'set-cell-switch-doc' });

    await joinDoc(owner, 'doc_sys_001', 'u1');
    owner.send({ type: 'join', docId: docB.docId, clientId: 'u1' });
    await owner.waitFor(4);

    owner.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'out' });
    await owner.waitFor(5);
    const last = owner.received.at(-1);
    assert.equal(last.type, 'error');
    assert.equal(last.code, 4003);
  } finally {
    await outsider.close();
    await owner.close();
    await srv.close();
  }
});

test('set_cell: 缺少 docId/clientId/row/col 返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1 });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.match(c.received[0].message, /docId, clientId, row and col are required/);

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 0, col: 1 });
    await c.waitFor(2);
    assert.equal(c.received[1].type, 'error');
    assert.equal(c.received[1].code, 4000);

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: -1, col: 1 });
    await c.waitFor(3);
    assert.equal(c.received[2].type, 'error');
    assert.equal(c.received[2].code, 4000);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: clientId 与当前 socket 身份不一致返回 4003', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u2', row: 1, col: 1, value: 'x' });
    await c.waitFor(3);
    assert.equal(c.received[2].type, 'error');
    assert.equal(c.received[2].code, 4003);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: 写入 audit 日志', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u_sc_audit');
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u_sc_audit', row: 1, col: 1, value: 'v' });
    await c.waitFor(4);
    await new Promise((r) => setImmediate(r));
    const auditLogStore = require('../store/auditLogStore');
    const logs = await auditLogStore.listByEventType('set_cell');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].docId, 'doc_sys_001');
    assert.equal(logs[0].clientId, 'u_sc_audit');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: 同一单元格连续写后写覆盖', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 3, col: 3, value: 'first' });
    await c.waitFor(base + 2);
    const seq1 = c.received[base].data.seq;

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 3, col: 3, value: 'second' });
    await c.waitFor(base + 4);
    const seq2 = c.received[base + 2].data.seq;

    assert.ok(seq2 > seq1);
    assert.equal(c.received[base + 2].data.value, 'second');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: docId 为数字类型返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'set_cell', docId: 123, clientId: 'u1', row: 1, col: 1, value: 'x' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: clientId 为空字符串返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: '', row: 1, col: 1, value: 'x' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: style 显式传 null 后再 join 快照中该 cell style 为 null', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    // 先写入有样式的值
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 5, col: 5, value: 'v', style: { bold: true } });
    await c.waitFor(base + 2);
    assert.deepEqual(c.received[base].data.style, { bold: true });

    // 再写同一格，显式 null 清除样式
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 5, col: 5, value: 'v', style: null });
    await c.waitFor(base + 4);
    assert.equal(c.received[base + 2].data.style, null);

    // join 后快照中该格 style 应为 null
    const c2 = await connect(srv.wsUrl);
    c2.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await c2.waitFor(1);
    const cellInSnap = c2.received[0].data.snapshot.cells['5:5'];
    assert.ok(cellInSnap, 'cell 5:5 should exist in snapshot');
    assert.equal(cellInSnap.row, 5);
    assert.equal(cellInSnap.col, 5);
    assert.equal(cellInSnap.styleId, null);
    await c2.close();
  } finally {
    await c.close();
    await srv.close();
  }
});

test('join: join_ack matches documented response format', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'user_001', name: 'Alice', color: '#ff0000' });
    await c.waitFor(1);

    const ack = c.received[0];
    assert.equal(ack.type, 'join_ack');
    assert.equal(ack.code, 0);
    assert.equal(ack.message, 'ok');
    assert.equal(ack.data.docId, 'doc_sys_001');
    assert.equal(ack.data.clientId, 'user_001');
    assert.equal(ack.data.currentSeq, 0);
    assertSnapshotMatchesDocFormat(ack.data.snapshot, {
      id: 'sheet_20260527_001',
      name: '2026年销售数据表',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      rowCount: 100,
      colCount: 26,
      styles: {
        style_header: {
          fontFamily: '微软雅黑',
          fontSize: 14,
          bold: true,
          color: '#FFFFFF',
          bgColor: '#4472C4',
          hAlign: 'center',
        },
        style_currency: {
          fontFamily: 'Arial',
          fontSize: 12,
          bold: false,
          hAlign: 'right',
        },
      },
      cells: {
        '0:0': { row: 0, col: 0, value: '产品名称', styleId: 'style_header' },
        '0:1': { row: 0, col: 1, value: '销售金额', styleId: 'style_header' },
        '1:1': { row: 1, col: 1, value: '9999.00', styleId: 'style_currency' },
      },
    });
    assert.ok(Array.isArray(ack.data.users));
    assert.equal(ack.data.users.length, 1);
    assert.deepEqual(ack.data.users[0], {
      id: 1,
      docId: 'doc_sys_001',
      clientId: 'user_001',
      name: 'Alice',
      color: '#ff0000',
      status: 'online',
      joinedAt: ack.data.users[0].joinedAt,
      lastActiveAt: ack.data.users[0].lastActiveAt,
    });
    assert.match(ack.data.users[0].joinedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(ack.data.users[0].lastActiveAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: 已有样式时省略 style 也会清空样式', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 7, col: 7, value: 'styled', style: { bold: true, color: '#333333' } });
    await c.waitFor(base + 2);
    assert.deepEqual(c.received[base].data.style, { bold: true, color: '#333333' });

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 7, col: 7, value: 'unstyled' });
    await c.waitFor(base + 4);
    assert.equal(c.received[base + 2].data.style, null);

    const c2 = await connect(srv.wsUrl);
    c2.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await c2.waitFor(1);
    const cellInSnap = c2.received[0].data.snapshot.cells['7:7'];
    assert.ok(cellInSnap, 'cell 7:7 should exist in snapshot');
    assert.equal(cellInSnap.styleId, null);
    await c2.close();
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: 并发写同一格，history 记录的 oldValue 是前一次写入值而非初始值', async () => {
  const srv = await createTestServer();
  const c1 = await connect(srv.wsUrl);
  const c2 = await connect(srv.wsUrl);
  try {
    await joinDoc(c1, 'doc_sys_001', 'u1');
    await joinDoc(c2, 'doc_sys_001', 'u2');

    // c1 先写入，确立 oldValue 基线
    const base1 = c1.received.length;
    const base2 = c2.received.length;
    c1.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 6, col: 6, value: 'first' });
    await Promise.all([c1.waitFor(base1 + 2), c2.waitFor(base2 + 1)]);
    const seq1 = c1.received[base1].data.seq;

    // c2 在 c1 写入后写同一格
    const afterFirstC1 = c1.received.length;
    const afterFirstC2 = c2.received.length;
    c2.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u2', row: 6, col: 6, value: 'second' });
    await Promise.all([c2.waitFor(afterFirstC2 + 2), c1.waitFor(afterFirstC1 + 1)]);
    const seq2 = c2.received[afterFirstC2].data.seq;
    assert.ok(seq2 > seq1);

    // 检查 historyStore 中 seq2 记录的 oldValue 应是 'first'（c1 写入的值），而非更早的值
    const historyStore = require('../store/historyStore');
    const entry = await historyStore.findByDocIdAndSeq('doc_sys_001', seq2);
    assert.equal(entry.oldValueJson.value, 'first');
  } finally {
    await c1.close();
    await c2.close();
    await srv.close();
  }
});

test('set_cell: 显式 baseSeq 会写入 history', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    const joinAck = await joinDoc(c, 'doc_sys_001', 'u_ot_base_seq');
    const baseSeq = joinAck.data.currentSeq;
    const base = c.received.length;

    c.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'u_ot_base_seq',
      row: 8,
      col: 8,
      value: 'ot-base-seq',
      baseSeq,
    });
    await c.waitFor(base + 2);

    const reply = c.received[base];
    assert.equal(reply.type, 'cell_updated');
    assert.equal('baseSeq' in reply.data, false);
    assert.equal('rebased' in reply.data, false);

    const historyStore = require('../store/historyStore');
    const entry = await historyStore.findByDocIdAndSeq('doc_sys_001', reply.data.seq);
    assert.equal(entry.baseSeq, baseSeq);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: stale baseSeq after import_sheet returns conflict barrier error', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    const joinAck = await joinDoc(c, 'doc_sys_001', 'u_ot_barrier');
    const staleBaseSeq = joinAck.data.currentSeq;

    c.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'u_ot_barrier',
      snapshot: {
        id: 'sheet_ot_barrier',
        name: 'OTBarrier',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '2:2': { row: 2, col: 2, value: 'imported', styleId: null },
        },
        styles: {},
        rowCount: 2,
        colCount: 2,
      },
    });
    await c.waitFor(c.received.length + 1);

    const base = c.received.length;
    c.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'u_ot_barrier',
      row: 2,
      col: 2,
      value: 'should-conflict',
      baseSeq: staleBaseSeq,
    });
    await c.waitFor(base + 1);

    const errorMessage = c.received[base];
    assert.equal(errorMessage.type, 'error');
    assert.equal(errorMessage.code, 4090);
    assert.match(errorMessage.message, /import_sheet/);
  } finally {
    await c.close();
    await srv.close();
  }
});

// ==================== import_sheet ====================

test('import_sheet: 返回 sheet_imported，data 字段结构完整', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    const snapshot = {
      id: 'sheet_import_001',
      name: '导入表',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      cells: { '1:1': { row: 1, col: 1, value: 'A', styleId: 'style_001' } },
      styles: { style_001: { bold: true } },
      rowCount: 1,
      colCount: 1,
    };
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await c.waitFor(1);
    const msg = c.received[0];
    assert.equal(msg.type, 'sheet_imported');
    assert.equal(msg.code, 0);
    assert.equal(msg.message, 'ok');
    const d = msg.data;
    assert.equal(d.docId, 'doc_sys_001');
    assert.equal(d.clientId, 'u1');
    assert.equal(typeof d.seq, 'number');
    assert.ok(d.seq >= 1);
    assert.deepEqual(d.snapshot, {
      id: 'sheet_import_001',
      name: '导入表',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      cells: { '1:1': { row: 1, col: 1, value: 'A', styleId: 'style_001' } },
      styles: { style_001: { bold: true } },
      rowCount: 1,
      colCount: 1,
    });
    assert.equal(d.canUndo, false);
    assert.equal(d.canRedo, false);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell: undo 栈超过上限时仅保留最近操作', async () => {
  const previousLimit = process.env.USER_OP_STACK_LIMIT;
  process.env.USER_OP_STACK_LIMIT = '3';
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);

  try {
    await joinDoc(c, 'doc_sys_001', 'u_stack_limit');
    const base = c.received.length;
    for (let row = 1; row <= 5; row += 1) {
      c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u_stack_limit', row, col: 1, value: `v${row}`, style: null });
      await c.waitFor(base + row * 2);
    }

    const userOpStateStore = require('../store/userOpStateStore');
    const state = await userOpStateStore.getState('doc_sys_001', 'u_stack_limit');
    assert.equal(state.undoStackJson.length, 3);
    assert.deepEqual(
      state.undoStackJson.map((entry) => entry.row),
      [3, 4, 5]
    );
  } finally {
    if (previousLimit === undefined) {
      delete process.env.USER_OP_STACK_LIMIT;
    } else {
      process.env.USER_OP_STACK_LIMIT = previousLimit;
    }
    await c.close();
    await srv.close();
  }
});

test('userOpState: TTL 过期后按读取惰性清理', async () => {
  const previousTtl = process.env.USER_OP_STATE_TTL_MS;
  process.env.USER_OP_STATE_TTL_MS = '10';
  clearBackendRequireCache();

  const userOpStateStore = require('../store/userOpStateStore');

  try {
    await userOpStateStore.saveState({
      docId: 'doc_ttl_001',
      clientId: 'u_ttl_cleanup',
      undoStackJson: [{ row: 1 }],
      redoStackJson: [],
      updatedAt: new Date(Date.now() - 1000).toISOString(),
    });

    const state = await userOpStateStore.getState('doc_ttl_001', 'u_ttl_cleanup');
    assert.equal(state, null);
  } finally {
    if (previousTtl === undefined) {
      delete process.env.USER_OP_STATE_TTL_MS;
    } else {
      process.env.USER_OP_STATE_TTL_MS = previousTtl;
    }
  }
});

test('import_sheet: matches documented request and response format', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    const snapshot = {
      id: 'sheet_20260527_001',
      name: '2026年销售数据表',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      rowCount: 100,
      colCount: 26,
      styles: {
        style_header: {
          fontFamily: '微软雅黑',
          fontSize: 14,
          bold: true,
          color: '#FFFFFF',
          bgColor: '#4472C4',
          hAlign: 'center',
        },
        style_currency: {
          fontFamily: 'Arial',
          fontSize: 12,
          bold: false,
          hAlign: 'right',
        },
      },
      cells: {
        '0:0': { row: 0, col: 0, value: '产品名称', styleId: 'style_header' },
        '0:1': { row: 0, col: 1, value: '销售金额', styleId: 'style_header' },
        '1:1': { row: 1, col: 1, value: '9999.00', styleId: 'style_currency' },
      },
    };

    c.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'user_001',
      snapshot,
    });
    await c.waitFor(1);

    const msg = c.received[0];
    assert.equal(msg.type, 'sheet_imported');
    assert.equal(msg.code, 0);
    assert.equal(msg.message, 'ok');
    assert.deepEqual(Object.keys(msg.data).sort(), ['canRedo', 'canUndo', 'clientId', 'docId', 'seq', 'snapshot']);
    assert.equal(msg.data.docId, 'doc_sys_001');
    assert.equal(msg.data.clientId, 'user_001');
    assert.equal(typeof msg.data.seq, 'number');
    assert.deepEqual(msg.data.snapshot, snapshot);
    assert.equal(msg.data.canUndo, false);
    assert.equal(msg.data.canRedo, false);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: 发送方收 2 条（reply + broadcast），其他成员收 1 条', async () => {
  const srv = await createTestServer();
  const sender = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    sender.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await sender.waitFor(2);
    other.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u2' });
    await Promise.all([other.waitFor(2), sender.waitFor(3)]);

    const baseS = sender.received.length;
    const baseO = other.received.length;
    const snapshot = {
      id: 'sheet_import_002',
      name: '导入表',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      cells: { '1:1': { row: 1, col: 1, value: 'X', styleId: 'style_001' } },
      styles: { style_001: { bold: true } },
      rowCount: 1,
      colCount: 1,
    };
    sender.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await Promise.all([sender.waitFor(baseS + 2), other.waitFor(baseO + 1)]);

    const senderMsgs = sender.received.slice(baseS);
    const otherMsgs = other.received.slice(baseO);
    assert.equal(senderMsgs.filter((m) => m.type === 'sheet_imported').length, 2);
    assert.equal(otherMsgs.filter((m) => m.type === 'sheet_imported').length, 1);
    assert.deepEqual(senderMsgs[0].data, senderMsgs[1].data);
    assert.deepEqual(senderMsgs[0].data.snapshot, snapshot);
    assert.deepEqual(otherMsgs[0].data.snapshot, snapshot);
  } finally {
    await sender.close();
    await other.close();
    await srv.close();
  }
});

test('import_sheet: seq 在 set_cell 之后继续递增（后写覆盖）', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'a' });
    await c.waitFor(base + 2);
    const seq1 = c.received[base].data.seq;

    const snapshot = { id: 'sheet_import_003', name: '空表', defaultRowHeight: 25, defaultColWidth: 100, cells: {}, styles: {}, rowCount: 0, colCount: 0 };
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await c.waitFor(base + 4);
    const seq2 = c.received[base + 2].data.seq;

    assert.ok(seq2 > seq1);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: import 后 set_cell seq 继续递增（后写覆盖）', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    const snapshot = {
      id: 'sheet_import_004',
      name: '导入表',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      cells: { '1:1': { row: 1, col: 1, value: 'imported', styleId: 'style_001' } },
      styles: { style_001: { bold: true } },
      rowCount: 1,
      colCount: 1,
    };
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await c.waitFor(base + 2);
    const seq1 = c.received[base].data.seq;

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 2, col: 1, value: 'after' });
    await c.waitFor(base + 4);
    const seq2 = c.received[base + 2].data.seq;

    assert.ok(seq2 > seq1);
    assert.equal(c.received[base + 2].data.value, 'after');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: 两次重复发送均执行写入，seq 递增', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    const snapshot = { id: 'sheet_import_006', name: '空表', defaultRowHeight: 25, defaultColWidth: 100, cells: {}, styles: {}, rowCount: 0, colCount: 0 };
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await c.waitFor(1);
    const seq1 = c.received[0].data.seq;

    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await c.waitFor(2);
    const seq2 = c.received[1].data.seq;

    assert.ok(seq2 > seq1);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: 缺少 snapshot 或 snapshot 非对象返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
    assert.match(c.received[0].message, /snapshot/);

    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot: [1, 2] });
    await c.waitFor(2);
    assert.equal(c.received[1].type, 'error');
    assert.equal(c.received[1].code, 4000);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: snapshot 内部字段类型不合法时仍按弱校验导入成功', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'u1',
      snapshot: {
        id: 123,
        name: false,
        defaultRowHeight: 'bad',
        defaultColWidth: null,
        rowCount: 'bad',
        colCount: {},
        styles: 1,
        cells: {
          '0:0': { row: 'bad', col: null, value: 'A', styleId: 123 },
        },
      },
    });
    await c.waitFor(1);

    assert.equal(c.received[0].type, 'sheet_imported');
    assert.equal(c.received[0].code, 0);
    assert.equal(c.received[0].data.snapshot.id, 'sheet_new_001');
    assert.equal(c.received[0].data.snapshot.name, 'Sheet1');
    assert.equal(c.received[0].data.snapshot.defaultRowHeight, 25);
    assert.equal(c.received[0].data.snapshot.defaultColWidth, 100);
    assert.equal(c.received[0].data.snapshot.rowCount, 0);
    assert.equal(c.received[0].data.snapshot.colCount, 0);
    assert.deepEqual(c.received[0].data.snapshot.styles, {});
    assert.deepEqual(c.received[0].data.snapshot.cells['0:0'], { row: 0, col: 0, value: 'A', styleId: null });
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: 缺少 clientId 返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', snapshot: { id: 'sheet_import_007', name: '空表', defaultRowHeight: 25, defaultColWidth: 100, cells: {}, styles: {}, rowCount: 0, colCount: 0 } });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: docId 为数字类型返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'import_sheet', docId: 999, clientId: 'u1', snapshot: { id: 'sheet_import_008', name: '空表', defaultRowHeight: 25, defaultColWidth: 100, cells: {}, styles: {}, rowCount: 0, colCount: 0 } });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: clientId 为空字符串返回 4000', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: '', snapshot: { id: 'sheet_import_009', name: '空表', defaultRowHeight: 25, defaultColWidth: 100, cells: {}, styles: {}, rowCount: 0, colCount: 0 } });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: 文档不存在返回 4004', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'import_sheet', docId: 'doc_nonexistent', clientId: 'u1', snapshot: { id: 'sheet_import_010', name: '空表', defaultRowHeight: 25, defaultColWidth: 100, cells: {}, styles: {}, rowCount: 0, colCount: 0 } });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4004);
    assert.match(c.received[0].message, /document not found/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: 写入 audit 日志', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u_imp_audit', snapshot: { id: 'sheet_import_011', name: '空表', defaultRowHeight: 25, defaultColWidth: 100, cells: {}, styles: {}, rowCount: 0, colCount: 0 } });
    await c.waitFor(1);
    await new Promise((r) => setImmediate(r));
    const auditLogStore = require('../store/auditLogStore');
    const logs = await auditLogStore.listByEventType('import_sheet');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].docId, 'doc_sys_001');
    assert.equal(logs[0].clientId, 'u_imp_audit');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('import_sheet: 两次重复发送会写入两条 audit 日志', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    const snapshot = { id: 'sheet_import_012', name: '空表', defaultRowHeight: 25, defaultColWidth: 100, cells: {}, styles: {}, rowCount: 0, colCount: 0 };
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await c.waitFor(1);
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await c.waitFor(2);
    await new Promise((r) => setImmediate(r));
    const auditLogStore = require('../store/auditLogStore');
    const logs = await auditLogStore.listByEventType('import_sheet');
    assert.equal(logs.length, 2);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('set_cell 后 import_sheet 清空 undo 栈，canUndo 恒为 false', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    await joinDoc(c, 'doc_sys_001', 'u1');
    const base = c.received.length;
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'a' });
    await c.waitFor(base + 2);
    assert.equal(c.received[base].data.canUndo, true);

    const snapshot = {
      id: 'sheet_import_013',
      name: '导入表',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      cells: { '1:1': { row: 1, col: 1, value: 'imported', styleId: 'style_001' } },
      styles: { style_001: { bold: true } },
      rowCount: 1,
      colCount: 1,
    };
    c.send({ type: 'import_sheet', docId: 'doc_sys_001', clientId: 'u1', snapshot });
    await c.waitFor(base + 4);
    assert.equal(c.received[base + 2].data.canUndo, false);
    assert.equal(c.received[base + 2].data.canRedo, false);
  } finally {
    await c.close();
    await srv.close();
  }
});


// ==================== undo ====================

test('undo: set_cell 후 undo 하면 값이 복원되고 undo_applied 반환', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'new', style: null });
    await c.waitFor(4); // +reply +broadcast

    c.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(6); // +reply +broadcast

    const undo = c.received.find((m) => m.type === 'undo_applied');
    assert.ok(undo, 'should receive undo_applied');
    assert.equal(undo.code, 0);
    assert.equal(undo.data.row, 1);
    assert.equal(undo.data.col, 1);
    assert.equal(undo.data.value, '9999.00');
    assert.equal(undo.data.canUndo, false);
    assert.equal(undo.data.canRedo, true);
    assert.equal(typeof undo.data.seq, 'number');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('undo: 同单元格已有后续写入时会重放为 noop，不覆盖最新值', async () => {
  const srv = await createTestServer();
  const owner = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    await joinDoc(owner, 'doc_sys_001', 'u_undo_ot_owner');
    await joinDoc(other, 'doc_sys_001', 'u_undo_ot_other');

    let ownerBase = owner.received.length;
    let otherBase = other.received.length;
    owner.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'u_undo_ot_owner',
      row: 31,
      col: 1,
      value: 'owner-first',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    other.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'u_undo_ot_other',
      row: 31,
      col: 1,
      value: 'other-latest',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 1),
      other.waitFor(otherBase + 2),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    owner.send({
      type: 'undo',
      docId: 'doc_sys_001',
      clientId: 'u_undo_ot_owner',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    const undoReply = owner.received[ownerBase];
    assert.equal(undoReply.type, 'undo_applied');
    assert.equal(undoReply.data.value, 'other-latest');
    assert.equal('rebased' in undoReply.data, false);
    assert.equal('noop' in undoReply.data, false);

    const docStore = require('../store/docStore');
    const doc = await docStore.getDocState('doc_sys_001');
    assert.equal(doc.snapshotJson.cells['31:1'].value, 'other-latest');
  } finally {
    await owner.close();
    await other.close();
    await srv.close();
  }
});

test('undo: sourceSeq 之后遇到 import_sheet barrier 时返回 4090', async () => {
  const srv = await createTestServer();
  const owner = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    await joinDoc(owner, 'doc_sys_001', 'u_undo_barrier_owner');
    await joinDoc(other, 'doc_sys_001', 'u_undo_barrier_other');

    let ownerBase = owner.received.length;
    let otherBase = other.received.length;
    owner.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'u_undo_barrier_owner',
      row: 32,
      col: 1,
      value: 'owner-before-import',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    other.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'u_undo_barrier_other',
      snapshot: {
        id: 'sheet_undo_barrier',
        name: 'UndoBarrier',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '1:1': { row: 1, col: 1, value: 'imported-barrier', styleId: null },
        },
        styles: {},
        rowCount: 1,
        colCount: 1,
      },
    });
    await Promise.all([
      owner.waitFor(ownerBase + 1),
      other.waitFor(otherBase + 2),
    ]);

    ownerBase = owner.received.length;
    owner.send({
      type: 'undo',
      docId: 'doc_sys_001',
      clientId: 'u_undo_barrier_owner',
    });
    await owner.waitFor(ownerBase + 1);

    const errorReply = owner.received[ownerBase];
    assert.equal(errorReply.type, 'error');
    assert.equal(errorReply.code, 4090);
    assert.match(errorReply.message, /import_sheet/);
  } finally {
    await owner.close();
    await other.close();
    await srv.close();
  }
});

test('undo: undo 스택이 비어 있으면 4000 반환', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);

    c.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(3);

    const err = c.received.find((m) => m.type === 'error');
    assert.ok(err);
    assert.equal(err.code, 4000);
    assert.match(err.message, /nothing to undo/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('undo: docId/clientId 비어있으면 4000 반환', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'undo', docId: '', clientId: 'u1' });
    await c.waitFor(1);
    assert.equal(c.received[0].type, 'error');
    assert.equal(c.received[0].code, 4000);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('undo: 未 join、离开房间或 clientId 与当前 socket 身份不一致时返回 4003', async () => {
  const srv = await createTestServer();
  const outsider = await connect(srv.wsUrl);
  const owner = await connect(srv.wsUrl);
  try {
    outsider.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await outsider.waitFor(1);
    assert.equal(outsider.received[0].type, 'error');
    assert.equal(outsider.received[0].code, 4003);

    owner.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await owner.waitFor(2);
    owner.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'X', style: null });
    await owner.waitFor(4);

    owner.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u2' });
    await owner.waitFor(5);
    const last = owner.received.at(-1);
    assert.equal(last.type, 'error');
    assert.equal(last.code, 4003);

    const { createDoc } = require('../service/docsService');
    const docB = await createDoc({ title: 'undo-switch-doc' });
    owner.send({ type: 'join', docId: docB.docId, clientId: 'u1' });
    await owner.waitFor(7);

    owner.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await owner.waitFor(8);
    const afterSwitch = owner.received.at(-1);
    assert.equal(afterSwitch.type, 'error');
    assert.equal(afterSwitch.code, 4003);
  } finally {
    await outsider.close();
    await owner.close();
    await srv.close();
  }
});

test('undo: history 失败时按当前驱动策略处理', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  const historyStore = require('../store/historyStore');
  const docStore = require('../store/docStore');
  const userOpStateStore = require('../store/userOpStateStore');
  const isMysqlDriver = process.env.STORE_DRIVER === 'mysql';
  const originalAppend = historyStore.append;
  historyStore.append = async (entry) => {
    if (entry.opType === 'undo') {
      throw new Error('history unavailable');
    }
    return originalAppend.call(historyStore, entry);
  };

  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 3, col: 1, value: 'undo-me', style: null });
    await c.waitFor(4);

    c.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(5);
    await c.noMoreFor(150);

    const undoMsgs = c.received.filter((m) => m.type === 'undo_applied');
    const errorMsgs = c.received.filter((m) => m.type === 'error');
    const doc = await docStore.getDocState('doc_sys_001');
    const opState = await userOpStateStore.getState('doc_sys_001', 'u1');

    if (isMysqlDriver) {
      assert.equal(undoMsgs.length, 0);
      assert.equal(errorMsgs.length, 1);
      assert.equal(errorMsgs[0].code, 5000);
      assert.equal(doc.snapshotJson.cells['3:1'].value, 'undo-me');
      assert.equal(opState.undoStackJson.length, 1);
    } else {
      assert.equal(undoMsgs.length, 2);
      assert.equal(errorMsgs.length, 0);
      assert.equal(doc.snapshotJson.cells['3:1'].value, '');
      assert.equal(opState.undoStackJson.length, 0);
    }
  } finally {
    historyStore.append = originalAppend;
    await c.close();
    await srv.close();
  }
});

test('undo: undo 후 발송자 2 조, 관찰자 1 조 수신', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  const observer = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);
    observer.send({ type: 'join', docId: 'doc_sys_001', clientId: 'obs' });
    await observer.waitFor(1);

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 2, col: 1, value: 'X', style: null });
    await Promise.all([c.waitFor(4), observer.waitFor(2)]);

    c.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await Promise.all([c.waitFor(6), observer.waitFor(3)]);

    const cUndos = c.received.filter((m) => m.type === 'undo_applied');
    const obsUndos = observer.received.filter((m) => m.type === 'undo_applied');
    assert.equal(cUndos.length, 2, 'sender gets reply + broadcast');
    assert.equal(obsUndos.length, 1, 'observer gets broadcast only');
  } finally {
    await c.close();
    await observer.close();
    await srv.close();
  }
});

// ==================== redo ====================

test('redo: undo 후 redo 하면 값이 재적용되고 redo_applied 반환', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'edited', style: null });
    await c.waitFor(4);

    c.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(6);

    c.send({ type: 'redo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(8);

    const redo = c.received.find((m) => m.type === 'redo_applied');
    assert.ok(redo, 'should receive redo_applied');
    assert.equal(redo.code, 0);
    assert.equal(redo.data.row, 1);
    assert.equal(redo.data.col, 1);
    assert.equal(redo.data.value, 'edited'); // 편집값 재적용
    assert.equal(redo.data.canUndo, true);
    assert.equal(redo.data.canRedo, false);
    assert.equal(typeof redo.data.seq, 'number');
  } finally {
    await c.close();
    await srv.close();
  }
});

test('redo: noop undo 之后继续 redo 也保持 noop，不覆盖最新值', async () => {
  const srv = await createTestServer();
  const owner = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    await joinDoc(owner, 'doc_sys_001', 'u_redo_ot_owner');
    await joinDoc(other, 'doc_sys_001', 'u_redo_ot_other');

    let ownerBase = owner.received.length;
    let otherBase = other.received.length;
    owner.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'u_redo_ot_owner',
      row: 33,
      col: 1,
      value: 'owner-first-redo',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    other.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'u_redo_ot_other',
      row: 33,
      col: 1,
      value: 'other-latest-redo',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 1),
      other.waitFor(otherBase + 2),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    owner.send({
      type: 'undo',
      docId: 'doc_sys_001',
      clientId: 'u_redo_ot_owner',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    owner.send({
      type: 'redo',
      docId: 'doc_sys_001',
      clientId: 'u_redo_ot_owner',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    const redoReply = owner.received[ownerBase];
    assert.equal(redoReply.type, 'redo_applied');
    assert.equal(redoReply.data.value, 'other-latest-redo');
    assert.equal('noop' in redoReply.data, false);

    const docStore = require('../store/docStore');
    const doc = await docStore.getDocState('doc_sys_001');
    assert.equal(doc.snapshotJson.cells['33:1'].value, 'other-latest-redo');
  } finally {
    await owner.close();
    await other.close();
    await srv.close();
  }
});

test('redo: undo 之后若遇到 import_sheet barrier 则返回 4090', async () => {
  const srv = await createTestServer();
  const owner = await connect(srv.wsUrl);
  const other = await connect(srv.wsUrl);
  try {
    await joinDoc(owner, 'doc_sys_001', 'u_redo_barrier_owner');
    await joinDoc(other, 'doc_sys_001', 'u_redo_barrier_other');

    let ownerBase = owner.received.length;
    let otherBase = other.received.length;
    owner.send({
      type: 'set_cell',
      docId: 'doc_sys_001',
      clientId: 'u_redo_barrier_owner',
      row: 34,
      col: 1,
      value: 'owner-before-redo-barrier',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    owner.send({
      type: 'undo',
      docId: 'doc_sys_001',
      clientId: 'u_redo_barrier_owner',
    });
    await Promise.all([
      owner.waitFor(ownerBase + 2),
      other.waitFor(otherBase + 1),
    ]);

    ownerBase = owner.received.length;
    otherBase = other.received.length;
    other.send({
      type: 'import_sheet',
      docId: 'doc_sys_001',
      clientId: 'u_redo_barrier_other',
      snapshot: {
        id: 'sheet_redo_barrier',
        name: 'RedoBarrier',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '1:1': { row: 1, col: 1, value: 'redo-imported-barrier', styleId: null },
        },
        styles: {},
        rowCount: 1,
        colCount: 1,
      },
    });
    await Promise.all([
      owner.waitFor(ownerBase + 1),
      other.waitFor(otherBase + 2),
    ]);

    ownerBase = owner.received.length;
    owner.send({
      type: 'redo',
      docId: 'doc_sys_001',
      clientId: 'u_redo_barrier_owner',
    });
    await owner.waitFor(ownerBase + 1);

    const errorReply = owner.received[ownerBase];
    assert.equal(errorReply.type, 'error');
    assert.equal(errorReply.code, 4090);
    assert.match(errorReply.message, /import_sheet/);
  } finally {
    await owner.close();
    await other.close();
    await srv.close();
  }
});

test('redo: redo 스택이 비어 있으면 4000 반환', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);

    c.send({ type: 'redo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(3);

    const err = c.received.find((m) => m.type === 'error');
    assert.ok(err);
    assert.equal(err.code, 4000);
    assert.match(err.message, /nothing to redo/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('redo: 未 join、离开房间或 clientId 与当前 socket 身份不一致时返回 4003', async () => {
  const srv = await createTestServer();
  const outsider = await connect(srv.wsUrl);
  const owner = await connect(srv.wsUrl);
  try {
    outsider.send({ type: 'redo', docId: 'doc_sys_001', clientId: 'u1' });
    await outsider.waitFor(1);
    assert.equal(outsider.received[0].type, 'error');
    assert.equal(outsider.received[0].code, 4003);

    owner.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await owner.waitFor(2);
    owner.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 2, value: 'redo-me', style: null });
    await owner.waitFor(4);
    owner.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await owner.waitFor(6);

    owner.send({ type: 'redo', docId: 'doc_sys_001', clientId: 'u2' });
    await owner.waitFor(7);
    const last = owner.received.at(-1);
    assert.equal(last.type, 'error');
    assert.equal(last.code, 4003);

    const { createDoc } = require('../service/docsService');
    const docB = await createDoc({ title: 'redo-switch-doc' });
    owner.send({ type: 'join', docId: docB.docId, clientId: 'u1' });
    await owner.waitFor(9);

    owner.send({ type: 'redo', docId: 'doc_sys_001', clientId: 'u1' });
    await owner.waitFor(10);
    const afterSwitch = owner.received.at(-1);
    assert.equal(afterSwitch.type, 'error');
    assert.equal(afterSwitch.code, 4003);
  } finally {
    await outsider.close();
    await owner.close();
    await srv.close();
  }
});

test('redo: applySetCell 成功后 audit 失败仍返回 redo_applied，不补发 500', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  const auditService = require('../audit/auditService');
  const originalRecord = auditService.recordAuditEvent;
  auditService.recordAuditEvent = async (entry) => {
    if (entry.type === 'redo') {
      throw new Error('audit unavailable');
    }
    return originalRecord(entry);
  };

  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 2, col: 2, value: 'redo-me', style: null });
    await c.waitFor(4);
    c.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(6);

    c.send({ type: 'redo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(8);
    await c.noMoreFor(150);

    const redoMsgs = c.received.filter((m) => m.type === 'redo_applied');
    assert.equal(redoMsgs.length, 2);
    assert.equal(c.received.filter((m) => m.type === 'error').length, 0);
  } finally {
    auditService.recordAuditEvent = originalRecord;
    await c.close();
    await srv.close();
  }
});

test('redo: set_cell 후 redo 스택 초기화 — redo 불가', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'A', style: null });
    await c.waitFor(4);
    c.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(6);
    // redo 스택에 항목이 있는 상태에서 새 set_cell → redo 스택 초기화
    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'B', style: null });
    await c.waitFor(8);

    c.send({ type: 'redo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(9);

    const err = c.received.find((m) => m.type === 'error');
    assert.ok(err);
    assert.equal(err.code, 4000);
    assert.match(err.message, /nothing to redo/);
  } finally {
    await c.close();
    await srv.close();
  }
});

test('undo/redo: seq 단조증가 유지', async () => {
  const srv = await createTestServer();
  const c = await connect(srv.wsUrl);
  try {
    c.send({ type: 'join', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(2);

    c.send({ type: 'set_cell', docId: 'doc_sys_001', clientId: 'u1', row: 1, col: 1, value: 'v1', style: null });
    await c.waitFor(4);
    c.send({ type: 'undo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(6);
    c.send({ type: 'redo', docId: 'doc_sys_001', clientId: 'u1' });
    await c.waitFor(8);

    const seqMsgs = c.received.filter((m) => m.data && typeof m.data.seq === 'number' && m.type !== 'join_ack');
    const seqs = seqMsgs.map((m) => m.data.seq);
    // 각 작업의 고유 seq 만 추출(reply+broadcast 중복 제거)
    const uniqueSeqs = [...new Set(seqs)];
    for (let i = 1; i < uniqueSeqs.length; i++) {
      assert.ok(uniqueSeqs[i] > uniqueSeqs[i - 1], `seq should be monotonically increasing: ${uniqueSeqs}`);
    }
  } finally {
    await c.close();
    await srv.close();
  }
});
