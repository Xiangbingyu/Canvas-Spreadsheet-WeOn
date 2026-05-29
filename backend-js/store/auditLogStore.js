const storeConfig = require('../config/storeConfig');
const createMemoryAuditLogStore = require('./memory/auditLogMemoryStore');
const createAuditLogMysqlStore = require('./mysql/auditLogMysqlStore');

function createAuditLogStore() {
  return storeConfig.driver === 'mysql'
    ? createAuditLogMysqlStore()
    : createMemoryAuditLogStore();
}

module.exports = createAuditLogStore();
