const realtimeConfig = require('../../config/realtimeConfig');
const { createRealtimeKeys } = require('../../infra/redis/realtimeKeys');
const { createRealtimeClient } = require('../../infra/redis/realtimeClient');
const { evalCommit } = require('../../infra/redis/realtimeLua');
const stream = require('../../infra/redis/stream');

// 文档实时态 Store：rt:state + rt:seq 的读写 + Lua 原子提交。
// Phase 0 仅"放好零件"，不接入任何写链路（docsService 在 Phase 1 才路由到这里）。
// memory 实现供无 Redis 环境的单测；redis 实现是 Phase 1 的真相层。

function createMemoryDocRealtimeStore() {
  const stateByDocId = new Map();
  const seqByDocId = new Map();
  const streamByDocId = new Map();

  return {
    type: 'memory',

    async getState(docId) {
      if (!seqByDocId.has(docId)) {
        return null;
      }
      return {
        docId,
        currentSeq: seqByDocId.get(docId),
        snapshotJson: stateByDocId.get(docId) || null,
      };
    },

    async seed(docId, { snapshotJson, currentSeq }) {
      stateByDocId.set(docId, snapshotJson);
      seqByDocId.set(docId, Number.isInteger(currentSeq) ? currentSeq : 0);
      if (!streamByDocId.has(docId)) {
        streamByDocId.set(docId, []);
      }
    },

    // 原子提交：基于已 rebase 后的最终 state 分配 seq、写 state、追加 stream。
    async commit(docId, { expectedBaseSeq = null, snapshotJson, event }) {
      const cur = seqByDocId.get(docId) || 0;
      if (expectedBaseSeq !== null && Number.isInteger(expectedBaseSeq) && expectedBaseSeq > cur) {
        return { ok: false, conflict: true, currentSeq: cur };
      }

      const newSeq = cur + 1;
      seqByDocId.set(docId, newSeq);
      stateByDocId.set(docId, snapshotJson);

      const entries = streamByDocId.get(docId) || [];
      const enriched = { ...event, seq: newSeq };
      entries.push(enriched);
      streamByDocId.set(docId, entries);

      return { ok: true, conflict: false, seq: newSeq, streamId: `${newSeq}-0`, event: enriched };
    },

    async readStreamRange(docId, fromSeq, toSeq) {
      const entries = streamByDocId.get(docId) || [];
      return entries.filter((entry) => entry.seq > fromSeq && entry.seq <= toSeq);
    },

    async close() {
      stateByDocId.clear();
      seqByDocId.clear();
      streamByDocId.clear();
    },
  };
}

function createRedisDocRealtimeStore() {
  const connection = createRealtimeClient('realtime-doc-state');
  const keys = createRealtimeKeys();

  return {
    type: 'redis',

    async getState(docId) {
      const client = await connection.ensureReady();
      if (!client) {
        return null;
      }
      const [seqRaw, stateRaw] = await Promise.all([
        client.get(keys.seqKey(docId)),
        client.get(keys.stateKey(docId)),
      ]);
      if (seqRaw === null && stateRaw === null) {
        return null;
      }
      return {
        docId,
        currentSeq: Number.parseInt(seqRaw || '0', 10),
        snapshotJson: stateRaw ? JSON.parse(stateRaw) : null,
      };
    },

    async seed(docId, { snapshotJson, currentSeq }) {
      const client = await connection.ensureReady();
      const multi = client.multi();
      multi.set(keys.seqKey(docId), String(Number.isInteger(currentSeq) ? currentSeq : 0));
      multi.set(keys.stateKey(docId), JSON.stringify(snapshotJson));
      multi.set(keys.checkpointKey(docId), String(Number.isInteger(currentSeq) ? currentSeq : 0));
      await multi.exec();
    },

    async commit(docId, { expectedBaseSeq = null, snapshotJson, event }) {
      const client = await connection.ensureReady();
      return evalCommit(client, {
        seqKey: keys.seqKey(docId),
        stateKey: keys.stateKey(docId),
        streamKey: keys.streamKey(docId),
        expectedBaseSeq,
        stateJson: JSON.stringify(snapshotJson),
        eventJson: JSON.stringify(event),
      });
    },

    async readStreamRange(docId, fromSeq, toSeq) {
      const client = await connection.ensureReady();
      const rows = await stream.rangeBySeq(client, {
        streamKey: keys.streamKey(docId),
        fromSeq,
        toSeq,
      });
      return (rows || []).map((row) => JSON.parse(row.message.event));
    },

    async close() {
      await connection.close();
    },
  };
}

function createDocRealtimeStore() {
  return realtimeConfig.driver === 'redis'
    ? createRedisDocRealtimeStore()
    : createMemoryDocRealtimeStore();
}

module.exports = createDocRealtimeStore();
module.exports.createMemoryDocRealtimeStore = createMemoryDocRealtimeStore;
module.exports.createRedisDocRealtimeStore = createRedisDocRealtimeStore;
