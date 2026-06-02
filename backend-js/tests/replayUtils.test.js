'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDocStoreCommand,
  isHistoryDuplicateError,
  computeNextCheckpoint,
} = require('../worker/replayUtils');

test('buildDocStoreCommand: set_title 映射出 docStore 所需 title 字段', () => {
  const command = buildDocStoreCommand('doc_001', {
    opType: 'set_title',
    seq: 12,
    newValueJson: { title: 'New Title' },
  });

  assert.deepEqual(command, {
    docId: 'doc_001',
    seq: 12,
    title: 'New Title',
  });
});

test('buildDocStoreCommand: set_cell 映射为 sheetId/row/col/value/style', () => {
  const command = buildDocStoreCommand('doc_001', {
    opType: 'set_cell',
    seq: 9,
    targetSheetId: 'sheet_001',
    targetRow: 3,
    targetCol: 4,
    newValueJson: { value: 'A1', style: { bold: true } },
  });

  assert.deepEqual(command, {
    docId: 'doc_001',
    seq: 9,
    sheetId: 'sheet_001',
    row: 3,
    col: 4,
    value: 'A1',
    style: { bold: true },
  });
});

test('buildDocStoreCommand: batch_set_cell 取每个坐标的 newValue/newStyle', () => {
  const command = buildDocStoreCommand('doc_001', {
    opType: 'batch_set_cell',
    seq: 21,
    payloadJson: {
      sheetId: 'sheet_009',
      updates: [
        { row: 1, col: 1, oldValue: 'x', newValue: 'y', newStyle: { color: 'red' } },
        { row: 2, col: 2, oldValue: 'a', newValue: 'b', newStyle: null },
      ],
    },
  });

  assert.deepEqual(command, {
    docId: 'doc_001',
    seq: 21,
    sheetId: 'sheet_009',
    updates: [
      { row: 1, col: 1, value: 'y', style: { color: 'red' } },
      { row: 2, col: 2, value: 'b', style: null },
    ],
  });
});

test('buildDocStoreCommand: import_sheet 映射为 snapshotJson', () => {
  const snapshotJson = { title: 'imported', sheets: {} };
  const command = buildDocStoreCommand('doc_001', {
    opType: 'import_sheet',
    seq: 30,
    payloadJson: snapshotJson,
  });

  assert.deepEqual(command, {
    docId: 'doc_001',
    seq: 30,
    snapshotJson,
  });
});

test('buildDocStoreCommand: undo/redo 单格事件映射为 set_cell 风格命令', () => {
  const command = buildDocStoreCommand('doc_001', {
    opType: 'undo',
    seq: 31,
    targetSheetId: 'sheet_001',
    targetRow: 5,
    targetCol: 6,
    newValueJson: { value: 'restored', style: { italic: true } },
  });

  assert.deepEqual(command, {
    docId: 'doc_001',
    seq: 31,
    sheetId: 'sheet_001',
    row: 5,
    col: 6,
    value: 'restored',
    style: { italic: true },
  });
});

test('buildDocStoreCommand: undo/redo 批量事件映射为 batch_set_cell 风格命令', () => {
  const command = buildDocStoreCommand('doc_001', {
    opType: 'redo',
    seq: 32,
    payloadJson: {
      type: 'batch_set_cell',
      sheetId: 'sheet_002',
      updates: [
        { row: 7, col: 8, newValue: 'redo-a', newStyle: { underline: true } },
      ],
    },
  });

  assert.deepEqual(command, {
    docId: 'doc_001',
    seq: 32,
    sheetId: 'sheet_002',
    updates: [
      { row: 7, col: 8, value: 'redo-a', style: { underline: true } },
    ],
  });
});

test('isHistoryDuplicateError: 识别 mysql 与 memory 的重复键错误', () => {
  assert.equal(isHistoryDuplicateError({ code: 'ER_DUP_ENTRY', message: 'Duplicate entry' }), true);
  assert.equal(isHistoryDuplicateError({ code: 'HISTORY_DUPLICATE_DOC_SEQ', message: 'history duplicate' }), true);
  assert.equal(isHistoryDuplicateError({ code: 'EOTHER', message: 'boom' }), false);
});

test('computeNextCheckpoint: 只在安全范围内推进 checkpoint', () => {
  assert.equal(computeNextCheckpoint(100, 130, 500), 100);
  assert.equal(computeNextCheckpoint(100, 900, 500), 400);
  assert.equal(computeNextCheckpoint(null, 30, 10), 20);
});
