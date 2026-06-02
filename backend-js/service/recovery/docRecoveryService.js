const docStore = require('../../store/docStore');
const docRealtimeStore = require('../../store/redis/docRealtimeStore');
const { normalizeDocSnapshot } = require('../../domain/entities/doc');

// 文档恢复服务：冷启动/恢复时从 MySQL 暖 Redis 实时态。
// 写热路径永不调用这里——仅在 getDocStateForWrite 在 redis 模式 miss 时触发（Phase 1）。

// 从 MySQL snapshot + current_seq 暖 Redis（首次访问/Redis 被清）。
async function seedRealtimeFromMysql(docId) {
  const stored = await docStore.getDocState(docId);

  if (!stored) {
    return null;
  }

  const snapshotJson = normalizeDocSnapshot(stored.snapshotJson, { docId });
  await docRealtimeStore.seed(docId, {
    snapshotJson,
    currentSeq: stored.currentSeq,
  });

  return {
    docId,
    currentSeq: stored.currentSeq,
    snapshotJson,
  };
}

// Redis 丢失/回退后重建：checkpoint + 回放 history.seq > checkpoint。
// Phase 1+2 完整实现（需 historyStore 回放 + 重建 stream/barrier）。
async function rebuildRealtime(docId) {
  // 占位：Phase 1+2 实现回放重建。首版退化为 seed（仅恢复 snapshot+seq）。
  return seedRealtimeFromMysql(docId);
}

module.exports = {
  seedRealtimeFromMysql,
  rebuildRealtime,
};
