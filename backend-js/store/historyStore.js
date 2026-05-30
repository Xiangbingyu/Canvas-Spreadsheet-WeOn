const storeConfig = require('../config/storeConfig');
const createMemoryHistoryStore = require('./memory/historyMemoryStore');
const createHistoryMysqlStore = require('./mysql/historyMysqlStore');

function createHistoryStore() {
  return storeConfig.driver === 'mysql'
    ? createHistoryMysqlStore()
    : createMemoryHistoryStore();
}

module.exports = createHistoryStore();
