// Apply&Store worker：消费 rt:stream → 幂等写 MySQL history。
// Phase 0 占位：不消费。Phase 1+2 实现消费循环 + applyX({...event, seq}) 落盘。
// 与 Gate 仅通过 stream 通信，不共享内存、不互调函数。

function createOpLogFlushWorker() {
  let running = false;

  return {
    name: 'opLogFlushWorker',

    async start() {
      // Phase 1+2 实现：循环 docOpStreamStore.readBatch → historyStore.append
      //                + docStore.applyX({...event, seq}) → ack。
      running = true;
    },

    async stop() {
      running = false;
    },

    isRunning() {
      return running;
    },
  };
}

module.exports = {
  createOpLogFlushWorker,
};
