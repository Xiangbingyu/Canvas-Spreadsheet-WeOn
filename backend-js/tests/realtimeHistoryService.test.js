const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasCompleteSeqCoverage,
  listRealtimeHistoryByDocIdSeqRange,
} = require('../service/realtimeHistoryService');

test('hasCompleteSeqCoverage validates contiguous seq coverage', () => {
  assert.equal(hasCompleteSeqCoverage([], 3, 3), true);
  assert.equal(hasCompleteSeqCoverage([{ seq: 4 }, { seq: 5 }], 3, 5), true);
  assert.equal(hasCompleteSeqCoverage([{ seq: 4 }, { seq: 6 }], 3, 6), false);
  assert.equal(hasCompleteSeqCoverage([{ seq: 5 }, { seq: 6 }], 3, 6), false);
});

test('realtime history prefers redis only when stream fully covers requested seq range', async () => {
  let persistedReadCount = 0;

  const entries = await listRealtimeHistoryByDocIdSeqRange('doc_001', 3, 5, {
    persistedHistoryStore: {
      async listByDocIdSeqRange() {
        persistedReadCount += 1;
        return [];
      },
    },
    realtimeDocStateService: {
      async listOps(docId, options = {}) {
        if (options.afterId) {
          return [];
        }

        return [
          { id: '1-0', op: { docId, seq: 4, opType: 'set_cell' } },
          { id: '2-0', op: { docId, seq: 5, opType: 'set_title' } },
        ];
      },
    },
  });

  assert.equal(persistedReadCount, 0);
  assert.deepEqual(entries.map((entry) => entry.seq), [4, 5]);
});

test('realtime history falls back to mysql when redis stream does not fully cover requested range', async () => {
  let persistedReadCount = 0;

  const entries = await listRealtimeHistoryByDocIdSeqRange('doc_001', 3, 6, {
    persistedHistoryStore: {
      async listByDocIdSeqRange() {
        persistedReadCount += 1;
        return [
          { docId: 'doc_001', seq: 4, opType: 'set_cell' },
          { docId: 'doc_001', seq: 5, opType: 'set_title' },
        ];
      },
    },
    realtimeDocStateService: {
      async listOps(docId, options = {}) {
        if (!options.afterId) {
          return [
            { id: '1-0', op: { docId, seq: 5, opType: 'set_title' } },
            { id: '2-0', op: { docId, seq: 6, opType: 'set_cell' } },
          ];
        }

        return [];
      },
    },
  });

  assert.equal(persistedReadCount, 1);
  assert.deepEqual(entries.map((entry) => entry.seq), [4, 5, 6]);
  assert.equal(entries[1].opType, 'set_title');
  assert.equal(entries[2].opType, 'set_cell');
});
