'use strict';

const assert = require('node:assert/strict');
const WebSocket = require('ws');

const httpBase = (process.env.SHADOW_HTTP_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const wsBase = (process.env.SHADOW_WS_BASE_URL || 'ws://127.0.0.1:3000').replace(/\/+$/, '');

function nowId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function httpRequest(method, path, body) {
  const response = await fetch(`${httpBase}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch (_error) {
    // keep raw text
  }
  return { status: response.status, body: data };
}

class WsClient {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(wsBase);
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      this.messages.push(JSON.parse(raw.toString()));
    });
  }

  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }

  async waitFor(predicate, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.messages.find(predicate);
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${this.name} waitFor timeout`);
  }

  async waitForCount(count, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.messages.length >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${this.name} waitForCount(${count}) timeout, got ${this.messages.length}`);
  }

  async waitForFrom(startIndex, predicate, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.messages.slice(startIndex).find(predicate);
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${this.name} waitForFrom timeout`);
  }

  countByType(type) {
    return this.messages.filter((message) => message.type === type).length;
  }

  latestByType(type) {
    const filtered = this.messages.filter((message) => message.type === type);
    return filtered[filtered.length - 1] || null;
  }

  async close() {
    if (!this.ws) {
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
      await new Promise((resolve) => {
        this.ws.once('close', resolve);
        setTimeout(resolve, 500);
      });
    }
  }
}

async function createDoc(createdBy, title) {
  const eventId = nowId('evt_shadow_doc');
  const response = await httpRequest('POST', '/docs', {
    title,
    createdBy,
    eventId,
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.code, 0);
  return response.body.data;
}

async function getDoc(docId) {
  const response = await httpRequest('GET', `/docs/${encodeURIComponent(docId)}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  return response.body.data;
}

async function listDocs(userId, scope = 'all') {
  const response = await httpRequest('GET', `/docs?userId=${encodeURIComponent(userId)}&scope=${scope}&page=1&pageSize=50`);
  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  return response.body.data;
}

async function joinDoc(client, { docId, clientId, name }) {
  const base = client.messages.length;
  client.send({
    type: 'join',
    docId,
    clientId,
    name,
    color: '#0f766e',
  });
  await client.waitForCount(base + 2);
  return client.latestByType('join_ack');
}

function getActiveSheet(snapshot) {
  return snapshot.sheets[snapshot.activeSheetId];
}

async function runCase(name, fn, results) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    results.push({ name, ok: true });
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    results.push({ name, ok: false, error: error.message });
  }
}

async function main() {
  const results = [];

  await runCase('1. List/Get/Create 协同实时可见', async () => {
    const createdBy = nowId('shadow_user');
    const title = nowId('shadow_doc');
    const created = await createDoc(createdBy, title);
    const fetched = await getDoc(created.docId);
    const listed = await listDocs(createdBy, 'created');

    assert.equal(fetched.docId, created.docId);
    assert.equal(fetched.title, title);
    assert.ok(listed.list.some((item) => item.docId === created.docId));
  }, results);

  await runCase('2. Join/Leave presence 广播', async () => {
    const owner = nowId('owner');
    const doc = await createDoc(owner, nowId('join_doc'));
    const c1 = new WsClient('c1');
    const c2 = new WsClient('c2');
    try {
      await c1.connect();
      await c2.connect();
      await joinDoc(c1, { docId: doc.docId, clientId: 'u_a', name: 'A' });
      assert.ok(c1.countByType('presence') >= 1);

      await joinDoc(c2, { docId: doc.docId, clientId: 'u_b', name: 'B' });
      const joinPresence = await c1.waitFor((message) => (
        message.type === 'presence'
        && Array.isArray(message.data.users)
        && message.data.users.some((user) => user.clientId === 'u_b')
      ));
      assert.ok(joinPresence);

      await c2.close();
      const leavePresence = await c1.waitFor((message) => (
        message.type === 'presence'
        && Array.isArray(message.data.users)
        && !message.data.users.some((user) => user.clientId === 'u_b')
      ));
      assert.ok(leavePresence);
    } finally {
      await c1.close();
      await c2.close();
    }
  }, results);

  await runCase('3. Cursor Relay 携带 sheetId', async () => {
    const owner = nowId('owner');
    const doc = await createDoc(owner, nowId('cursor_doc'));
    const state = await getDoc(doc.docId);
    const sheetId = state.snapshot.activeSheetId;
    const c1 = new WsClient('c1');
    const c2 = new WsClient('c2');
    try {
      await c1.connect();
      await c2.connect();
      await joinDoc(c1, { docId: doc.docId, clientId: 'u_a', name: 'A' });
      await joinDoc(c2, { docId: doc.docId, clientId: 'u_b', name: 'B' });
      c1.send({ type: 'cursor', docId: doc.docId, clientId: 'u_a', sheetId, row: 3, col: 4 });

      const cursor1 = await c1.waitFor((message) => message.type === 'cursor_update' && message.data.clientId === 'u_a');
      const cursor2 = await c2.waitFor((message) => message.type === 'cursor_update' && message.data.clientId === 'u_a');
      assert.equal(cursor1.data.sheetId, sheetId);
      assert.equal(cursor2.data.sheetId, sheetId);
    } finally {
      await c1.close();
      await c2.close();
    }
  }, results);

  await runCase('4. Set Cell OT transform + undo/redo + import 冲突', async () => {
    const owner = nowId('owner');
    const doc = await createDoc(owner, nowId('ot_doc'));
    const initial = await getDoc(doc.docId);
    const sheetId = initial.snapshot.activeSheetId;
    const c1 = new WsClient('c1');
    try {
      await c1.connect();
      const ack1 = await joinDoc(c1, { docId: doc.docId, clientId: 'u_ot_1', name: 'A' });
      let base1 = c1.messages.length;
      c1.send({
        type: 'set_cell',
        docId: doc.docId,
        clientId: 'u_ot_1',
        sheetId,
        baseSeq: ack1.data.currentSeq,
        row: 10,
        col: 10,
        value: 'seed-row-count',
      });
      const seeded = await c1.waitForFrom(base1, (message) => (
        message.type === 'cell_updated' && message.data.value === 'seed-row-count'
      ));
      const staleBaseSeq = seeded.data.seq;

      base1 = c1.messages.length;
      c1.send({ type: 'insert_row', docId: doc.docId, clientId: 'u_ot_1', sheetId, row: 1 });
      await c1.waitForFrom(base1, (message) => message.type === 'row_inserted');

      base1 = c1.messages.length;
      c1.send({
        type: 'set_cell',
        docId: doc.docId,
        clientId: 'u_ot_1',
        sheetId,
        baseSeq: staleBaseSeq,
        row: 5,
        col: 1,
        value: 'rebased-value',
      });
      const rebased = await c1.waitForFrom(base1, (message) => (
        message.type === 'cell_updated' && message.data.value === 'rebased-value'
      ));
      assert.equal(rebased.data.row, 6);

      base1 = c1.messages.length;
      c1.send({ type: 'undo', docId: doc.docId, clientId: 'u_ot_1' });
      const undo = await c1.waitForFrom(base1, (message) => message.type === 'undo_applied');
      assert.equal(undo.data.row, 6);
      assert.equal(undo.data.value, '');

      base1 = c1.messages.length;
      c1.send({ type: 'redo', docId: doc.docId, clientId: 'u_ot_1' });
      const redo = await c1.waitForFrom(base1, (message) => message.type === 'redo_applied');
      assert.equal(redo.data.row, 6);
      assert.equal(redo.data.value, 'rebased-value');

      base1 = c1.messages.length;
      c1.send({
        type: 'set_cell',
        docId: doc.docId,
        clientId: 'u_ot_1',
        sheetId,
        baseSeq: redo.data.seq,
        row: 8,
        col: 1,
        value: 'before-import',
      });
      const beforeImport = await c1.waitForFrom(base1, (message) => (
        message.type === 'cell_updated' && message.data.value === 'before-import'
      ));

      const c2 = new WsClient('c2');
      await c2.connect();
      await joinDoc(c2, { docId: doc.docId, clientId: 'u_ot_2', name: 'B' });
      const base2 = c2.messages.length;
      c2.send({
        type: 'import_sheet',
        docId: doc.docId,
        clientId: 'u_ot_2',
        eventId: nowId('evt_import'),
        snapshot: {
          activeSheetId: 'sheet_import_001',
          sheetOrder: ['sheet_import_001'],
          sheets: {
            sheet_import_001: {
              id: 'sheet_import_001',
              name: 'Imported',
              defaultRowHeight: 25,
              defaultColWidth: 100,
              rowCount: 1,
              colCount: 1,
              styles: {},
              cells: {
                '1:1': { row: 1, col: 1, value: 'imported', styleId: null },
              },
            },
          },
        },
      });
      await c2.waitForFrom(base2, (message) => message.type === 'sheet_imported');

      base1 = c1.messages.length;
      c1.send({ type: 'undo', docId: doc.docId, clientId: 'u_ot_1' });
      const conflict = await c1.waitForFrom(base1, (message) => message.type === 'error' && message.code === 4090);
      assert.match(conflict.message, /import_sheet/);
      assert.ok(beforeImport.data.seq > redo.data.seq);
      await c2.close();
    } finally {
      await c1.close();
    }
  }, results);

  await runCase('5. Batch Set Cell style-only 保留 value 并回传 oldValue', async () => {
    const owner = nowId('owner');
    const doc = await createDoc(owner, nowId('batch_doc'));
    const initial = await getDoc(doc.docId);
    const sheetId = initial.snapshot.activeSheetId;
    const c1 = new WsClient('c1');
    try {
      await c1.connect();
      const ack = await joinDoc(c1, { docId: doc.docId, clientId: 'u_batch', name: 'A' });

      c1.send({
        type: 'set_cell',
        docId: doc.docId,
        clientId: 'u_batch',
        sheetId,
        baseSeq: ack.data.currentSeq,
        row: 12,
        col: 2,
        value: 'preserve-me',
      });
      const seeded = await c1.waitFor((message) => message.type === 'cell_updated' && message.data.value === 'preserve-me');

      c1.send({
        type: 'batch_set_cell',
        docId: doc.docId,
        clientId: 'u_batch',
        sheetId,
        baseSeq: seeded.data.seq,
        updates: [{ row: 12, col: 2 }],
        style: { bold: true },
      });
      const batch = await c1.waitFor((message) => message.type === 'batch_cell_updated');
      const updatedCell = batch.data.updates.find((update) => update.row === 12 && update.col === 2);
      assert.ok(updatedCell);
      assert.equal(updatedCell.value, 'preserve-me');
      assert.equal(updatedCell.oldValue, 'preserve-me');

      const state = await getDoc(doc.docId);
      assert.equal(getActiveSheet(state.snapshot).cells['12:2'].value, 'preserve-me');
    } finally {
      await c1.close();
    }
  }, results);

  await runCase('6. Insert/Delete Column/Row 处理策略', async () => {
    const owner = nowId('owner');
    const doc = await createDoc(owner, nowId('structure_doc'));
    const initial = await getDoc(doc.docId);
    const sheetId = initial.snapshot.activeSheetId;
    const c1 = new WsClient('c1');
    try {
      await c1.connect();
      const ack = await joinDoc(c1, { docId: doc.docId, clientId: 'u_struct', name: 'A' });

      c1.send({ type: 'set_cell', docId: doc.docId, clientId: 'u_struct', sheetId, baseSeq: ack.data.currentSeq, row: 4, col: 4, value: 'shift-me' });
      const first = await c1.waitFor((message) => message.type === 'cell_updated' && message.data.value === 'shift-me');

      c1.send({ type: 'insert_col', docId: doc.docId, clientId: 'u_struct', sheetId, col: 2 });
      await c1.waitFor((message) => message.type === 'col_inserted');
      c1.send({ type: 'insert_row', docId: doc.docId, clientId: 'u_struct', sheetId, row: 2 });
      await c1.waitFor((message) => message.type === 'row_inserted');

      let state = await getDoc(doc.docId);
      let sheet = getActiveSheet(state.snapshot);
      assert.equal(sheet.cells['5:5'].value, 'shift-me');

      c1.send({ type: 'delete_col', docId: doc.docId, clientId: 'u_struct', sheetId, col: 2 });
      await c1.waitFor((message) => message.type === 'col_deleted');
      c1.send({ type: 'delete_row', docId: doc.docId, clientId: 'u_struct', sheetId, row: 2 });
      await c1.waitFor((message) => message.type === 'row_deleted');

      state = await getDoc(doc.docId);
      sheet = getActiveSheet(state.snapshot);
      assert.equal(sheet.cells['4:4'].value, 'shift-me');
      assert.ok(first.data.seq < state.currentSeq);
    } finally {
      await c1.close();
    }
  }, results);

  await runCase('7. Add Sheet 支持', async () => {
    const owner = nowId('owner');
    const doc = await createDoc(owner, nowId('add_sheet_doc'));
    const c1 = new WsClient('c1');
    try {
      await c1.connect();
      await joinDoc(c1, { docId: doc.docId, clientId: 'u_sheet', name: 'A' });
      c1.send({ type: 'add_sheet', docId: doc.docId, clientId: 'u_sheet', sheetName: 'Smoke Sheet' });
      const added = await c1.waitFor((message) => message.type === 'sheet_added');
      assert.equal(added.data.sheet.name, 'Smoke Sheet');

      const state = await getDoc(doc.docId);
      assert.equal(state.snapshot.activeSheetId, added.data.sheet.id);
      assert.ok(state.snapshot.sheetOrder.includes(added.data.sheet.id));
    } finally {
      await c1.close();
    }
  }, results);

  await runCase('8. Import Sheet 支持 + Undo/Redo 维护', async () => {
    const owner = nowId('owner');
    const doc = await createDoc(owner, nowId('import_doc'));
    const c1 = new WsClient('c1');
    try {
      await c1.connect();
      const ack = await joinDoc(c1, { docId: doc.docId, clientId: 'u_import', name: 'A' });
      const sheetId = ack.data.snapshot.activeSheetId;

      c1.send({ type: 'set_cell', docId: doc.docId, clientId: 'u_import', sheetId, baseSeq: ack.data.currentSeq, row: 2, col: 2, value: 'undo-redo' });
      await c1.waitFor((message) => message.type === 'cell_updated' && message.data.value === 'undo-redo');
      c1.send({ type: 'undo', docId: doc.docId, clientId: 'u_import' });
      await c1.waitFor((message) => message.type === 'undo_applied');
      c1.send({ type: 'redo', docId: doc.docId, clientId: 'u_import' });
      await c1.waitFor((message) => message.type === 'redo_applied');

      c1.send({
        type: 'import_sheet',
        docId: doc.docId,
        clientId: 'u_import',
        eventId: nowId('evt_import'),
        snapshot: {
          activeSheetId: 'sheet_import_final',
          sheetOrder: ['sheet_import_final'],
          sheets: {
            sheet_import_final: {
              id: 'sheet_import_final',
              name: 'Imported Final',
              defaultRowHeight: 25,
              defaultColWidth: 100,
              rowCount: 1,
              colCount: 1,
              styles: {},
              cells: {
                '1:1': { row: 1, col: 1, value: 'final', styleId: null },
              },
            },
          },
        },
      });
      const imported = await c1.waitFor((message) => message.type === 'sheet_imported');
      assert.equal(imported.data.canUndo, false);
      assert.equal(imported.data.canRedo, false);

      const state = await getDoc(doc.docId);
      assert.equal(state.snapshot.activeSheetId, 'sheet_import_final');
      assert.equal(getActiveSheet(state.snapshot).cells['1:1'].value, 'final');
    } finally {
      await c1.close();
    }
  }, results);

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;

  console.log('\n=== Shadow Smoke Summary ===');
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ` -> ${result.error}` : ''}`);
  }
  console.log(`Summary: ${passed}/${results.length} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
