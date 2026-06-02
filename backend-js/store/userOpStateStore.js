const storeConfig = require('../config/storeConfig');
const realtimeConfig = require('../config/realtimeConfig');
const createMemoryUserOpStateStore = require('./memory/userOpStateMemoryStore');
const createUserOpStateMysqlStore = require('./mysql/userOpStateMysqlStore');
const { createUserOpRealtimeStore } = require('./redis/userOpRealtimeStore');

function createUserOpStateStore() {
  if (realtimeConfig.driver === 'redis') return createUserOpRealtimeStore();
  return storeConfig.driver === 'mysql'
    ? createUserOpStateMysqlStore()
    : createMemoryUserOpStateStore();
}

module.exports = createUserOpStateStore();
