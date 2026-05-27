const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function clearBackendRequireCache() {
  for (const modulePath of Object.keys(require.cache)) {
    if (
      modulePath.startsWith(projectRoot) &&
      !modulePath.includes(`${path.sep}node_modules${path.sep}`) &&
      modulePath !== __filename
    ) {
      delete require.cache[modulePath];
    }
  }
}

async function createTestServer() {
  clearBackendRequireCache();

  const app = require('../app');
  const server = app.listen(0);

  await once(server, 'listening');

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
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

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);

  return {
    status: response.status,
    json: await response.json(),
  };
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

// ==================== POST /docs：创建文档并校验初始状态与审计日志 ====================
test('POST /docs creates a new online sheet with initial snapshot', async () => {
  const server = await createTestServer();

  try {
    const response = await postJson(server.baseUrl, '/docs', {
      title: 'test-sheet',
      createdBy: 'user_001',
      eventId: 'evt_create_doc_001',
    });

    assert.equal(response.status, 201);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.data.docId, 'doc_001');
    assert.equal(response.json.data.title, 'test-sheet');
    assert.equal(response.json.data.currentSeq, 0);
    assert.equal(response.json.data.createdBy, 'user_001');
    assert.deepEqual(response.json.data.snapshot, {
      id: 'sheet_doc_001_001',
      name: 'Sheet1',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      cells: {},
      styles: {},
      rowCount: 0,
      colCount: 0,
    });

    const auditLogStore = require('../store/auditLogStore');
    const auditLogs = await auditLogStore.listByEventType('doc_created');

    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].docId, 'doc_001');
    assert.equal(auditLogs[0].clientId, 'user_001');
    assert.equal(auditLogs[0].requestId, 'evt_create_doc_001');
    assert.equal(auditLogs[0].payloadJson.title, 'test-sheet');
  } finally {
    await server.close();
  }
});

test('POST /docs matches documented response format', async () => {
  const server = await createTestServer();

  try {
    const response = await postJson(server.baseUrl, '/docs', {
      title: '季度报表',
      createdBy: 'user_001',
      eventId: 'evt_create_doc_format_001',
    });

    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.json).sort(), ['code', 'data', 'message']);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.message, 'ok');
    assert.equal(response.json.data.docId, 'doc_001');
    assert.equal(response.json.data.title, '季度报表');
    assert.equal(response.json.data.currentSeq, 0);
    assert.equal(response.json.data.createdBy, 'user_001');
    assert.match(response.json.data.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(response.json.data.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assertSnapshotMatchesDocFormat(response.json.data.snapshot, {
      id: 'sheet_doc_001_001',
      name: 'Sheet1',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      rowCount: 0,
      colCount: 0,
      styles: {},
      cells: {},
    });
  } finally {
    await server.close();
  }
});

// ==================== POST /docs：相同 eventId 命中幂等并返回第一次结果 ====================
test('POST /docs returns remembered result for duplicate eventId', async () => {
  const server = await createTestServer();

  try {
    const firstResponse = await postJson(server.baseUrl, '/docs', {
      title: 'first-title',
      createdBy: 'user_001',
      eventId: 'evt_create_doc_002',
    });
    const secondResponse = await postJson(server.baseUrl, '/docs', {
      title: 'second-title',
      createdBy: 'user_999',
      eventId: 'evt_create_doc_002',
    });

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    assert.deepEqual(secondResponse.json, firstResponse.json);
  } finally {
    await server.close();
  }
});

// ==================== POST /docs：不传 eventId 时重复创建会生成不同文档 ====================
test('POST /docs creates different documents when eventId is missing', async () => {
  const server = await createTestServer();

  try {
    const firstResponse = await postJson(server.baseUrl, '/docs', {
      title: 'without-event-id-1',
      createdBy: 'user_010',
    });
    const secondResponse = await postJson(server.baseUrl, '/docs', {
      title: 'without-event-id-2',
      createdBy: 'user_010',
    });

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    assert.notEqual(firstResponse.json.data.docId, secondResponse.json.data.docId);
    assert.equal(firstResponse.json.data.snapshot.id, `sheet_${firstResponse.json.data.docId}_001`);
    assert.equal(secondResponse.json.data.snapshot.id, `sheet_${secondResponse.json.data.docId}_001`);
  } finally {
    await server.close();
  }
});

// ==================== POST /docs：非法 eventId 返回参数错误 ====================
test('POST /docs rejects invalid eventId', async () => {
  const server = await createTestServer();

  try {
    const response = await postJson(server.baseUrl, '/docs', {
      title: 'invalid-event-id-doc',
      eventId: '   ',
    });

    assert.equal(response.status, 400);
    assert.equal(response.json.code, 4000);
    assert.equal(response.json.message, 'eventId must be a non-empty string');
  } finally {
    await server.close();
  }
});

// ==================== POST /docs：相同 eventId 不会重复写入审计日志 ====================
test('POST /docs does not write duplicate audit logs for duplicate eventId', async () => {
  const server = await createTestServer();

  try {
    const auditLogStore = require('../store/auditLogStore');

    await postJson(server.baseUrl, '/docs', {
      title: 'audit-idempotent-doc',
      createdBy: 'user_020',
      eventId: 'evt_create_doc_020',
    });
    await postJson(server.baseUrl, '/docs', {
      title: 'audit-idempotent-doc-duplicated',
      createdBy: 'user_021',
      eventId: 'evt_create_doc_020',
    });

    const auditLogs = await auditLogStore.listByEventType('doc_created');

    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].requestId, 'evt_create_doc_020');
  } finally {
    await server.close();
  }
});

// ==================== POST /docs：相同 eventId 不会重复写入 docStore ====================
test('POST /docs does not create duplicate docStore records for duplicate eventId', async () => {
  const server = await createTestServer();

  try {
    const docStore = require('../store/docStore');

    await postJson(server.baseUrl, '/docs', {
      title: 'store-idempotent-doc',
      createdBy: 'user_030',
      eventId: 'evt_create_doc_030',
    });
    await postJson(server.baseUrl, '/docs', {
      title: 'store-idempotent-doc-duplicated',
      createdBy: 'user_031',
      eventId: 'evt_create_doc_030',
    });

    const docs = await docStore.list();
    const createdDocs = docs.filter((doc) => doc.docId !== 'doc_sys_001');

    assert.equal(createdDocs.length, 1);
    assert.equal(createdDocs[0].title, 'store-idempotent-doc');
  } finally {
    await server.close();
  }
});

// ==================== POST /docs：空白标题返回参数错误 ====================
test('POST /docs rejects blank title', async () => {
  const server = await createTestServer();

  try {
    const response = await postJson(server.baseUrl, '/docs', {
      title: '   ',
    });

    assert.equal(response.status, 400);
    assert.equal(response.json.code, 4000);
    assert.equal(response.json.message, 'title must be a non-empty string');
  } finally {
    await server.close();
  }
});

// ==================== GET /docs：scope=created 返回当前用户创建的文档列表 ====================
test('GET /docs returns created documents for the given user', async () => {
  const server = await createTestServer();

  try {
    await postJson(server.baseUrl, '/docs', {
      title: 'created-doc-1',
      createdBy: 'user_docs_created',
      eventId: 'evt_docs_created_001',
    });
    await postJson(server.baseUrl, '/docs', {
      title: 'created-doc-2',
      createdBy: 'user_docs_created',
      eventId: 'evt_docs_created_002',
    });
    await postJson(server.baseUrl, '/docs', {
      title: 'other-user-doc',
      createdBy: 'user_docs_other',
      eventId: 'evt_docs_created_003',
    });

    const response = await getJson(
      server.baseUrl,
      '/docs?userId=user_docs_created&scope=created&page=1&pageSize=10'
    );

    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.data.total, 2);
    assert.equal(response.json.data.list.length, 2);
    assert.deepEqual(
      response.json.data.list.map((item) => item.title),
      ['created-doc-2', 'created-doc-1']
    );
    assert.deepEqual(
      response.json.data.list.map((item) => item.relation),
      ['created', 'created']
    );
  } finally {
    await server.close();
  }
});

// ==================== GET /docs：scope=participated 返回当前用户参与的文档列表 ====================
test('GET /docs returns participated documents for the given user', async () => {
  const server = await createTestServer();

  try {
    const roomUserStore = require('../store/roomUserStore');

    const createdDocResponse = await postJson(server.baseUrl, '/docs', {
      title: 'participated-doc',
      createdBy: 'owner_user_001',
      eventId: 'evt_docs_participated_001',
    });
    const ownDocResponse = await postJson(server.baseUrl, '/docs', {
      title: 'own-doc',
      createdBy: 'user_docs_participated',
      eventId: 'evt_docs_participated_002',
    });

    await roomUserStore.upsertRoomUser(createdDocResponse.json.data.docId, {
      clientId: 'user_docs_participated',
      name: '参与者',
      status: 'offline',
    });
    await roomUserStore.upsertRoomUser(ownDocResponse.json.data.docId, {
      clientId: 'user_docs_participated',
      name: '创建者本人',
      status: 'offline',
    });

    const response = await getJson(
      server.baseUrl,
      '/docs?userId=user_docs_participated&scope=participated&page=1&pageSize=10'
    );

    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.data.total, 1);
    assert.equal(response.json.data.list.length, 1);
    assert.equal(response.json.data.list[0].title, 'participated-doc');
    assert.equal(response.json.data.list[0].relation, 'participated');
  } finally {
    await server.close();
  }
});

// ==================== GET /docs：room_user 改为离线保留后仍可查询参与文档 ====================
test('GET /docs keeps participated documents after room user becomes offline', async () => {
  const server = await createTestServer();

  try {
    const roomUserStore = require('../store/roomUserStore');

    const createdDocResponse = await postJson(server.baseUrl, '/docs', {
      title: 'offline-participated-doc',
      createdBy: 'owner_user_002',
      eventId: 'evt_docs_participated_003',
    });

    await roomUserStore.upsertRoomUser(createdDocResponse.json.data.docId, {
      clientId: 'user_docs_offline',
      name: '离线参与者',
      status: 'online',
    });
    await roomUserStore.removeRoomUser(createdDocResponse.json.data.docId, 'user_docs_offline');

    const response = await getJson(
      server.baseUrl,
      '/docs?userId=user_docs_offline&scope=participated&page=1&pagesize=10'
    );
    const roomUsers = await roomUserStore.listByClientId('user_docs_offline');

    assert.equal(response.status, 200);
    assert.equal(response.json.data.total, 1);
    assert.equal(response.json.data.list[0].title, 'offline-participated-doc');
    assert.equal(roomUsers.length, 1);
    assert.equal(roomUsers[0].status, 'offline');
  } finally {
    await server.close();
  }
});

// ==================== GET /docs：scope=all 合并创建与参与文档并按 docId 去重 ====================
test('GET /docs merges created and participated documents without duplication', async () => {
  const server = await createTestServer();

  try {
    const roomUserStore = require('../store/roomUserStore');

    const createdDocResponse = await postJson(server.baseUrl, '/docs', {
      title: 'all-created-doc',
      createdBy: 'user_docs_all',
      eventId: 'evt_docs_all_001',
    });
    const participatedDocResponse = await postJson(server.baseUrl, '/docs', {
      title: 'all-participated-doc',
      createdBy: 'owner_user_003',
      eventId: 'evt_docs_all_002',
    });

    await roomUserStore.upsertRoomUser(createdDocResponse.json.data.docId, {
      clientId: 'user_docs_all',
      name: '创建者本人',
      status: 'online',
    });
    await roomUserStore.upsertRoomUser(participatedDocResponse.json.data.docId, {
      clientId: 'user_docs_all',
      name: '参与者',
      status: 'online',
    });

    const response = await getJson(
      server.baseUrl,
      '/docs?userId=user_docs_all&scope=all&page=1&pageSize=10'
    );

    assert.equal(response.status, 200);
    assert.equal(response.json.data.total, 2);
    assert.equal(response.json.data.list.length, 2);
    assert.deepEqual(
      response.json.data.list.map((item) => item.title),
      ['all-participated-doc', 'all-created-doc']
    );
    assert.deepEqual(
      response.json.data.list.map((item) => item.relation),
      ['participated', 'created']
    );
  } finally {
    await server.close();
  }
});

// ==================== GET /docs：列表接口支持分页参数 ====================
test('GET /docs paginates the result list', async () => {
  const server = await createTestServer();

  try {
    await postJson(server.baseUrl, '/docs', {
      title: 'paged-doc-1',
      createdBy: 'user_docs_paged',
      eventId: 'evt_docs_paged_001',
    });
    await postJson(server.baseUrl, '/docs', {
      title: 'paged-doc-2',
      createdBy: 'user_docs_paged',
      eventId: 'evt_docs_paged_002',
    });
    await postJson(server.baseUrl, '/docs', {
      title: 'paged-doc-3',
      createdBy: 'user_docs_paged',
      eventId: 'evt_docs_paged_003',
    });

    const response = await getJson(
      server.baseUrl,
      '/docs?userId=user_docs_paged&scope=created&page=2&pagesize=1'
    );

    assert.equal(response.status, 200);
    assert.equal(response.json.data.page, 2);
    assert.equal(response.json.data.pageSize, 1);
    assert.equal(response.json.data.total, 3);
    assert.equal(response.json.data.hasMore, true);
    assert.equal(response.json.data.list.length, 1);
    assert.equal(response.json.data.list[0].title, 'paged-doc-2');
  } finally {
    await server.close();
  }
});

// ==================== GET /docs：非法列表参数返回参数错误 ====================
test('GET /docs rejects invalid list query parameters', async () => {
  const server = await createTestServer();

  try {
    const response = await getJson(
      server.baseUrl,
      '/docs?userId=&scope=unknown&page=0&pageSize=200'
    );

    assert.equal(response.status, 400);
    assert.equal(response.json.code, 4000);
  } finally {
    await server.close();
  }
});

// ==================== GET /docs/:docId：POST 后立即 GET，返回当前文档状态 ====================
test('GET /docs/:docId returns current document state from cache', async () => {
  const server = await createTestServer();

  try {
    const createdResponse = await postJson(server.baseUrl, '/docs', {
      title: 'cache-doc',
      createdBy: 'user_002',
      eventId: 'evt_create_doc_003',
    });
    const response = await getJson(server.baseUrl, `/docs/${createdResponse.json.data.docId}`);

    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    assert.deepEqual(response.json.data, createdResponse.json.data);
  } finally {
    await server.close();
  }
});

test('GET /docs/:docId matches documented response format', async () => {
  const server = await createTestServer();

  try {
    const response = await getJson(server.baseUrl, '/docs/doc_sys_001');

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.json).sort(), ['code', 'data', 'message']);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.message, 'ok');
    assert.equal(response.json.data.docId, 'doc_sys_001');
    assert.equal(response.json.data.title, '2026年销售数据表');
    assert.equal(response.json.data.currentSeq, 0);
    assert.equal(response.json.data.createdBy, 'system');
    assert.match(response.json.data.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(response.json.data.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assertSnapshotMatchesDocFormat(response.json.data.snapshot, {
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
  } finally {
    await server.close();
  }
});

// ==================== GET /docs/:docId：缓存未命中时回退到 docStore 并回填缓存 ====================
test('GET /docs/:docId falls back to docStore and repopulates cache on cache miss', async () => {
  const server = await createTestServer();

  try {
    const createdResponse = await postJson(server.baseUrl, '/docs', {
      title: 'store-fallback-doc',
      createdBy: 'user_003',
      eventId: 'evt_create_doc_004',
    });
    const docsCache = require('../cache/docsCache');
    const { docStateKey } = require('../cache/cacheKeys');
    const docId = createdResponse.json.data.docId;
    const cacheKey = docStateKey(docId);

    docsCache.delete(cacheKey);
    assert.equal(docsCache.get(cacheKey), undefined);

    const response = await getJson(server.baseUrl, `/docs/${docId}`);

    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.data.docId, docId);
    assert.deepEqual(docsCache.get(cacheKey), response.json.data);
  } finally {
    await server.close();
  }
});

// ==================== GET /docs/:docId：文档不存在时返回 404 ====================
test('GET /docs/:docId returns 404 when document does not exist', async () => {
  const server = await createTestServer();

  try {
    const response = await getJson(server.baseUrl, '/docs/doc_999');

    assert.equal(response.status, 404);
    assert.equal(response.json.code, 4004);
    assert.equal(response.json.message, 'document not found: doc_999');
  } finally {
    await server.close();
  }
});
