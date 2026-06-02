const workerConfig = require('../config/workerConfig');
const { createOpLogFlushWorker } = require('./opLogFlushWorker');
const { createSnapshotMaterializeWorker } = require('./snapshotMaterializeWorker');

// Apply&Store worker 启动入口。Phase 0：workerConfig.enabled=false 时为 noop，
// 保证 server 启动行为不变。worker 与 Gate 同进程但仅通过 Redis Stream 通信。

let workers = null;

async function startWorkers() {
  if (!workerConfig.enabled) {
    return { started: false, reason: 'disabled' };
  }

  if (workers) {
    return { started: true, reason: 'already-running' };
  }

  workers = [
    createOpLogFlushWorker(),
    createSnapshotMaterializeWorker(),
  ];

  for (const worker of workers) {
    await worker.start();
  }

  console.log(`Apply&Store workers started: ${workers.map((w) => w.name).join(', ')}`);
  return { started: true, reason: 'ok' };
}

async function stopWorkers() {
  if (!workers) {
    return;
  }

  for (const worker of workers) {
    await worker.stop().catch(() => {});
  }

  workers = null;
}

module.exports = {
  startWorkers,
  stopWorkers,
};
