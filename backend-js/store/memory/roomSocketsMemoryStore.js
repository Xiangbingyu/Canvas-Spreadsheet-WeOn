function createRoomSocketsMemoryStore() {
  // roomSockets: Map<docId, Set<WebSocket>>
  // socketContext: Map<WebSocket, { docId, clientId }>
  // Purpose:
  // - roomSockets stores active connections for room broadcast
  // - socketContext helps clean up room membership on socket close
  // This is runtime-only connection state and does not map to a database table.
  const roomSockets = new Map();
  const socketContext = new Map();

  return {
    type: 'memory',
    roomSockets,
    socketContext,

    addSocketToRoom(docId, socket, clientId) {
      // TODO: bind socket to roomSockets and socketContext.
      return { docId, socket, clientId };
    },

    getRoomSockets(docId) {
      // TODO: return active sockets of the target room.
      return [];
    },

    removeSocket(socket) {
      // TODO: remove socket from roomSockets and clear socketContext.
      return null;
    },
  };
}

module.exports = createRoomSocketsMemoryStore;
