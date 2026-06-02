'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

// 在 require 配置前清掉相关环境变量，验证默认值（flag 默认关）。
function clearEnv() {
  delete process.env.REALTIME_STATE_DRIVER;
  delete process.env.OP_STREAM_DRIVER;
  delete process.env.PERSIST_WORKER_ENABLED;
  delete require.cache[require.resolve('../config/realtimeConfig')];
  delete require.cache[require.resolve('../config/streamConfig')];
  delete require.cache[require.resolve('../config/workerConfig')];
}

test('realtimeConfig: 默认 memory 驱动、不过期', () => {
  clearEnv();
  const cfg = require('../config/realtimeConfig');
  assert.equal(cfg.driver, 'memory');
  assert.equal(cfg.keyPrefix, 'collab:rt');
  assert.equal(cfg.stateTtlMs, 0);
});

test('streamConfig: 默认 memory 驱动、保留窗口 500', () => {
  clearEnv();
  const cfg = require('../config/streamConfig');
  assert.equal(cfg.driver, 'memory');
  assert.equal(cfg.consumerGroup, 'apply-store');
  assert.equal(cfg.batchSize, 64);
  assert.equal(cfg.retainCount, 500);
});

test('workerConfig: 默认 enabled=false', () => {
  clearEnv();
  const cfg = require('../config/workerConfig');
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.snapshotOpInterval, 200);
  assert.equal(cfg.snapshotTimeWindowMs, 30000);
});

test('startWorkers: 默认 disabled 时不启动（noop）', async () => {
  clearEnv();
  delete require.cache[require.resolve('../worker')];
  delete require.cache[require.resolve('../worker/index')];
  const { startWorkers, stopWorkers } = require('../worker');
  const result = await startWorkers();
  assert.equal(result.started, false);
  assert.equal(result.reason, 'disabled');
  await stopWorkers();
});
