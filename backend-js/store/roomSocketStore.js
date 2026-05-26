const createMemoryRoomSocketStore = require('./memory/roomSocketMemoryStore');

function createRoomSocketStore() {
  // Scaffold entry: first phase wires room socket store to memory implementation.
  return createMemoryRoomSocketStore();
}

module.exports = createRoomSocketStore();
