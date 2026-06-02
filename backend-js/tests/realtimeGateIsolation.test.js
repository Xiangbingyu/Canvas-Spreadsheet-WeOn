'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function clearBackendRequireCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.startsWith(projectRoot)
      && !key.includes(`${path.sep}node_modules${path.sep}`)
    ) {
      delete require.cache[key];
    }
  }
}

test('Redis Gate: invalidateDocCaches 不再回查 MySQL 元信息', async (t) => {
  const previousRealtimeDriver = process.env.REALTIME_STATE_DRIVER;

  process.env.REALTIME_STATE_DRIVER = 'redis';
  clearBackendRequireCache();

  const docsService = require('../service/docsService');
  const docStore = require('../store/docStore');
  const roomUserStore = require('../store/roomUserStore');

  const originalGetDocState = docStore.getDocState;
  const originalListByDocId = roomUserStore.listByDocId;

  docStore.getDocState = async () => {
    throw new Error('invalidateDocCaches should not read docStore in redis gate mode');
  };
  roomUserStore.listByDocId = async () => {
    throw new Error('invalidateDocCaches should not read roomUserStore in redis gate mode');
  };

  t.after(() => {
    docStore.getDocState = originalGetDocState;
    roomUserStore.listByDocId = originalListByDocId;
    if (previousRealtimeDriver === undefined) {
      delete process.env.REALTIME_STATE_DRIVER;
    } else {
      process.env.REALTIME_STATE_DRIVER = previousRealtimeDriver;
    }
    clearBackendRequireCache();
  });

  await docsService.invalidateDocCaches('doc_gate_001');
});

test('Redis Gate: 审计改为异步排队，不阻塞主流程', async (t) => {
  const previousRealtimeDriver = process.env.REALTIME_STATE_DRIVER;

  process.env.REALTIME_STATE_DRIVER = 'redis';
  clearBackendRequireCache();

  const auditService = require('../audit/auditService');
  const auditLogStore = require('../store/auditLogStore');

  const originalAppend = auditLogStore.append;
  let appendStarted = false;

  auditLogStore.append = async () => {
    appendStarted = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { id: 1 };
  };

  t.after(() => {
    auditLogStore.append = originalAppend;
    if (previousRealtimeDriver === undefined) {
      delete process.env.REALTIME_STATE_DRIVER;
    } else {
      process.env.REALTIME_STATE_DRIVER = previousRealtimeDriver;
    }
    clearBackendRequireCache();
  });

  const result = await auditService.recordAuditEvent({ type: 'set_cell', docId: 'doc_gate_001' });
  assert.equal(result.status, 'queued');
  assert.equal(appendStarted, false);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(appendStarted, true);
});
