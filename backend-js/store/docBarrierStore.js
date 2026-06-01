const storeConfig = require('../config/storeConfig');
const createDocBarrierMysqlStore = require('./mysql/docBarrierMysqlStore');
const createDocBarrierMemoryStore = require('./memory/docBarrierMemoryStore');

function createDocBarrierStore() {
  return storeConfig.driver === 'mysql'
    ? createDocBarrierMysqlStore()
    : createDocBarrierMemoryStore();
}

module.exports = createDocBarrierStore();
