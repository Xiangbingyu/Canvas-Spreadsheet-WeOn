const runtimeConfig = require('../config/runtimeConfig');
const docStore = require('./docStore');
const userOpStateStore = require('./userOpStateStore');
const snapshotCheckpointStore = require('./snapshotCheckpointStore');
const docBarrierStore = require('./docBarrierStore');
const createDocRealtimeRedisStore = require('./redis/docRealtimeRedisStore');
const createDocRealtimeMemoryStore = require('./memory/docRealtimeMemoryStore');

function createDocRealtimeStore() {
  return runtimeConfig.driver === 'redis'
    ? createDocRealtimeRedisStore({
      persistentDocStore: docStore,
      persistentUserOpStateStore: userOpStateStore,
      persistentSnapshotCheckpointStore: snapshotCheckpointStore,
      persistentDocBarrierStore: docBarrierStore,
    })
    : createDocRealtimeMemoryStore({
      persistentDocStore: docStore,
      persistentUserOpStateStore: userOpStateStore,
      persistentSnapshotCheckpointStore: snapshotCheckpointStore,
      persistentDocBarrierStore: docBarrierStore,
    });
}

module.exports = createDocRealtimeStore();
