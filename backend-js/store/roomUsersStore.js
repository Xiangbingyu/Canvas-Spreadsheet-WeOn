const createRoomUsersMemoryStore = require('./memory/roomUsersMemoryStore');

function createRoomUsersStore() {
  // Scaffold entry: first phase only wires roomUsers store to memory implementation.
  return createRoomUsersMemoryStore();
}

module.exports = createRoomUsersStore();
