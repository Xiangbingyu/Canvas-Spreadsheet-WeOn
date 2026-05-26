﻿﻿function createEventIdStore() {
  // 一期先把幂等记录保存在内存中。
  // 二期再为每条记录补充过期时间和清理策略，
  // 避免服务长时间运行后幂等记录持续增长。
  const processedEvents = new Map();

  return {
    processedEvents,

    has(eventId) {
      return processedEvents.has(eventId);
    },

    get(eventId) {
      return processedEvents.get(eventId) || null;
    },

    set(eventId, record) {
      // TODO: 后续把过期时间和记录一起保存，例如：
      // { value: record, expiresAt: Date.now() + ttlMs }
      processedEvents.set(eventId, record);
    },

    // TODO: 后续补充过期幂等记录的清理入口。
    // 可以考虑两种方向：
    // 1. 在读写时顺带清理过期记录
    // 2. 在内存模式下通过定时任务周期清理
  };
}

module.exports = createEventIdStore();
