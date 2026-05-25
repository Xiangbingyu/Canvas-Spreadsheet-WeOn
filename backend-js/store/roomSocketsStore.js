const createRoomSocketsMemoryStore = require('./memory/roomSocketsMemoryStore');

function createRoomSocketsStore() {
  // Scaffold entry: first phase only wires roomSockets store to memory implementation.
  return createRoomSocketsMemoryStore();
}

module.exports = createRoomSocketsStore();
