function createRoomUsersMemoryStore() {
  // roomUsers: Map<docId, Map<clientId, RoomUser>>
  // RoomUser fields:
  // - clientId: temporary user id
  // - name: display name in the room
  // - color: display color in presence list
  // This is runtime-only presence data and does not map to a first-phase database table.
  const roomUsers = new Map();

  return {
    type: 'memory',
    roomUsers,

    upsertRoomUser(docId, user) {
      // TODO: add or update online user in roomUsers.
      return { docId, user };
    },

    getRoomUsers(docId) {
      // TODO: return online users of the target room.
      return [];
    },

    removeRoomUser(docId, clientId) {
      // TODO: remove online user from roomUsers.
      return false;
    },
  };
}

module.exports = createRoomUsersMemoryStore;
