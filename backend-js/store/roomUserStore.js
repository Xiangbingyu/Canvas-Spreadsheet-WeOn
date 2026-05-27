const createMemoryRoomUserStore = require('./memory/roomUserMemoryStore');

function createRoomUserStore() {
  // Scaffold entry: first phase wires room user store to memory implementation.
  return createMemoryRoomUserStore();
}

module.exports = createRoomUserStore();
