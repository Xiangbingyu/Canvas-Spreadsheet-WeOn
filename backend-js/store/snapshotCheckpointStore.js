const storeConfig = require('../config/storeConfig');
const createSnapshotCheckpointMysqlStore = require('./mysql/snapshotCheckpointMysqlStore');
const createSnapshotCheckpointMemoryStore = require('./memory/snapshotCheckpointMemoryStore');

function createSnapshotCheckpointStore() {
  return storeConfig.driver === 'mysql'
    ? createSnapshotCheckpointMysqlStore()
    : createSnapshotCheckpointMemoryStore();
}

module.exports = createSnapshotCheckpointStore();
