const createMemoryUserOpStateStore = require('./memory/userOpStateMemoryStore');

function createUserOpStateStore() {
  // Scaffold entry: first phase wires user operation state store to memory implementation.
  return createMemoryUserOpStateStore();
}

module.exports = createUserOpStateStore();
