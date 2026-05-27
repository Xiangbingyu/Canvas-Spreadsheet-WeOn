const createMemoryAuditLogStore = require('./memory/auditLogMemoryStore');

function createAuditLogStore() {
  // Scaffold entry: first phase wires audit log store to memory implementation.
  return createMemoryAuditLogStore();
}

module.exports = createAuditLogStore();
