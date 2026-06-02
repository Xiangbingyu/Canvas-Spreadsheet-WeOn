const realtimeConfig = require('../../config/realtimeConfig');

// 统一构造 Redis 实时态 key。前缀来自 realtimeConfig.keyPrefix。
// 设计见 docs/Gate分阶段实施计划.md §0.2。
function docPrefix(prefix, docId) {
  return `${prefix}:doc:${docId}`;
}

function createRealtimeKeys(keyPrefix = realtimeConfig.keyPrefix) {
  const prefix = keyPrefix;

  return {
    prefix,
    seqKey(docId) {
      return `${docPrefix(prefix, docId)}:seq`;
    },
    stateKey(docId) {
      return `${docPrefix(prefix, docId)}:state`;
    },
    updatedAtKey(docId) {
      return `${docPrefix(prefix, docId)}:updated-at`;
    },
    streamKey(docId) {
      return `${docPrefix(prefix, docId)}:stream`;
    },
    barrierKey(docId) {
      return `${docPrefix(prefix, docId)}:barrier`;
    },
    checkpointKey(docId) {
      return `${docPrefix(prefix, docId)}:checkpoint`;
    },
    flushedSeqKey(docId) {
      return `${docPrefix(prefix, docId)}:flushed-seq`;
    },
    pendingCreateSetKey() {
      return `${prefix}:doc:pending-create`;
    },
    pendingMetaKey(docId) {
      return `${docPrefix(prefix, docId)}:pending-meta`;
    },
    createdDocsByUserKey(userId) {
      return `${prefix}:docs:created-by:${userId}`;
    },
    docIdCounterKey() {
      return `${prefix}:doc:id-counter`;
    },
    userOpKey(docId, clientId) {
      return `${docPrefix(prefix, docId)}:user-op:${clientId}`;
    },
  };
}

module.exports = {
  createRealtimeKeys,
  // 默认实例，使用全局配置前缀。
  realtimeKeys: createRealtimeKeys(),
};
