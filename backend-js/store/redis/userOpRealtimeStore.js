// 用户 undo/redo 栈的 Redis 实时态 Store。
// 占位：Phase 6 才接入（用户私有栈迁 Redis，MySQL 留作过渡恢复副本）。
// Phase 0 不实现读写，避免与现有 store/userOpStateStore.js 行为冲突。

function createUserOpRealtimeStore() {
  return {
    type: 'placeholder',
    // Phase 6 实现：getStack / saveStack / clearByDocId 等，
    // key 用 realtimeKeys.userOpKey(docId, clientId)。
  };
}

module.exports = createUserOpRealtimeStore();
module.exports.createUserOpRealtimeStore = createUserOpRealtimeStore;
