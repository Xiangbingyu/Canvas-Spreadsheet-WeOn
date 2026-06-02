// Apply&Store worker：按策略物化 doc snapshot + 推进 checkpoint + 裁剪 stream。
// Phase 0 占位：不物化。Phase 1+2 按 workerConfig.snapshotOpInterval / 时间窗口触发。

function createSnapshotMaterializeWorker() {
  let running = false;

  return {
    name: 'snapshotMaterializeWorker',

    async start() {
      // Phase 1+2 实现：达到 op 阈值/时间窗口 → docStore.updateSnapshot
      //                + 推进 rt:checkpoint + docOpStreamStore.trim。
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
  createSnapshotMaterializeWorker,
};
