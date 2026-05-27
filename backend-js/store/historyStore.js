const createMemoryHistoryStore = require('./memory/historyMemoryStore');

function createHistoryStore() {
  // Scaffold entry: first phase wires history store to memory implementation.
  return createMemoryHistoryStore();
}

module.exports = createHistoryStore();
