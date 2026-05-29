const storeConfig = require('../config/storeConfig');
const createMemoryUserOpStateStore = require('./memory/userOpStateMemoryStore');
const createUserOpStateMysqlStore = require('./mysql/userOpStateMysqlStore');

function createUserOpStateStore() {
  return storeConfig.driver === 'mysql'
    ? createUserOpStateMysqlStore()
    : createMemoryUserOpStateStore();
}

module.exports = createUserOpStateStore();
