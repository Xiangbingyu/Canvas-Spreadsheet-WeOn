'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildCursorBroadcast } = require('../service/gate/gateCursorService');

test('cursor broadcast 兼容 sheetID 入参并同时返回 sheetId/sheetID', () => {
  const payload = buildCursorBroadcast({
    docId: 'doc_066',
    clientId: 'user_001',
    sheetID: 'sheet_doc_066_001',
    row: 1,
    col: 1,
  });

  assert.equal(payload.sheetID, 'sheet_doc_066_001');
  assert.equal('sheetId' in payload, false);
});
