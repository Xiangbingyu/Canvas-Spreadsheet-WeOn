'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createRealtimeKeys } = require('../infra/redis/realtimeKeys');
const { evalCommit, COMMIT_CONFLICT } = require('../infra/redis/realtimeLua');
const { createMemoryDocRealtimeStore } = require('../store/redis/docRealtimeStore');

test('realtimeKeys: 构造统一前缀的 key', () => {
  const keys = createRealtimeKeys('collab:rt');
  assert.equal(keys.seqKey('doc_001'), 'collab:rt:doc:doc_001:seq');
  assert.equal(keys.stateKey('doc_001'), 'collab:rt:doc:doc_001:state');
  assert.equal(keys.streamKey('doc_001'), 'collab:rt:doc:doc_001:stream');
  assert.equal(keys.barrierKey('doc_001'), 'collab:rt:doc:doc_001:barrier');
  assert.equal(keys.checkpointKey('doc_001'), 'collab:rt:doc:doc_001:checkpoint');
  assert.equal(keys.userOpKey('doc_001', 'user_001'), 'collab:rt:doc:doc_001:user-op:user_001');
});

test('realtimeKeys: 自定义前缀生效', () => {
  const keys = createRealtimeKeys('custom:p');
  assert.equal(keys.seqKey('d'), 'custom:p:doc:d:seq');
});

test('evalCommit: 成功返回新 seq 与 streamId', async () => {
  const fakeClient = {
    async eval() {
      return [13, '13-0'];
    },
  };
  const result = await evalCommit(fakeClient, {
    seqKey: 's', stateKey: 't', streamKey: 'x',
    expectedBaseSeq: 12, stateJson: '{}', eventJson: '{}',
  });
  assert.equal(result.ok, true);
  assert.equal(result.conflict, false);
  assert.equal(result.seq, 13);
  assert.equal(result.streamId, '13-0');
});

test('evalCommit: baseSeq 超前返回冲突', async () => {
  const fakeClient = {
    async eval() {
      return [COMMIT_CONFLICT, 5];
    },
  };
  const result = await evalCommit(fakeClient, {
    seqKey: 's', stateKey: 't', streamKey: 'x',
    expectedBaseSeq: 99, stateJson: '{}', eventJson: '{}',
  });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.currentSeq, 5);
});

test('evalCommit: expectedBaseSeq=null 传空串跳过校验', async () => {
  let capturedArgs = null;
  const fakeClient = {
    async eval(_script, options) {
      capturedArgs = options.arguments;
      return [1, '1-0'];
    },
  };
  await evalCommit(fakeClient, {
    seqKey: 's', stateKey: 't', streamKey: 'x',
    expectedBaseSeq: null, stateJson: '{"a":1}', eventJson: '{"b":2}',
  });
  assert.equal(capturedArgs[0], '');
  assert.equal(capturedArgs[1], '{"a":1}');
  assert.equal(capturedArgs[2], '{"b":2}');
});

test('memory docRealtimeStore: seed 后可读回 state 与 seq', async () => {
  const store = createMemoryDocRealtimeStore();
  assert.equal(await store.getState('doc_x'), null);

  await store.seed('doc_x', { snapshotJson: { sheets: {} }, currentSeq: 7 });
  const state = await store.getState('doc_x');
  assert.equal(state.currentSeq, 7);
  assert.deepEqual(state.snapshotJson, { sheets: {} });
});

test('memory docRealtimeStore: commit 分配递增 seq 并追加 stream', async () => {
  const store = createMemoryDocRealtimeStore();
  await store.seed('doc_y', { snapshotJson: {}, currentSeq: 0 });

  const first = await store.commit('doc_y', {
    expectedBaseSeq: 0,
    snapshotJson: { v: 1 },
    event: { type: 'set_cell', clientId: 'c1' },
  });
  assert.equal(first.ok, true);
  assert.equal(first.seq, 1);
  assert.equal(first.streamId, '1-0');

  const second = await store.commit('doc_y', {
    expectedBaseSeq: 1,
    snapshotJson: { v: 2 },
    event: { type: 'set_cell', clientId: 'c2' },
  });
  assert.equal(second.seq, 2);

  const range = await store.readStreamRange('doc_y', 0, 2);
  assert.equal(range.length, 2);
  assert.equal(range[0].seq, 1);
  assert.equal(range[1].seq, 2);
});

test('memory docRealtimeStore: baseSeq 超前返回冲突且不推进 seq', async () => {
  const store = createMemoryDocRealtimeStore();
  await store.seed('doc_z', { snapshotJson: {}, currentSeq: 3 });

  const result = await store.commit('doc_z', {
    expectedBaseSeq: 99,
    snapshotJson: { v: 1 },
    event: { type: 'set_cell' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.currentSeq, 3);

  const state = await store.getState('doc_z');
  assert.equal(state.currentSeq, 3);
});

test('memory docRealtimeStore: readStreamRange 区间为 (from, to]', async () => {
  const store = createMemoryDocRealtimeStore();
  await store.seed('doc_r', { snapshotJson: {}, currentSeq: 0 });
  for (let i = 0; i < 3; i += 1) {
    await store.commit('doc_r', { expectedBaseSeq: i, snapshotJson: {}, event: { i } });
  }
  const range = await store.readStreamRange('doc_r', 1, 3);
  assert.deepEqual(range.map((e) => e.seq), [2, 3]);
});
