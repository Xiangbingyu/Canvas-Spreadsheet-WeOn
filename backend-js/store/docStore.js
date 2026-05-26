const createMemoryDocStore = require('./memory/docMemoryStore');

function createDocStore() {
  // Scaffold entry: first phase wires doc store to memory implementation.
  return createMemoryDocStore();
}

module.exports = createDocStore();
