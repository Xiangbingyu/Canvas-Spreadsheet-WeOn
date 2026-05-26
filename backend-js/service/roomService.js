const roomUserStore = require('../store/roomUserStore');
const roomSocketStore = require('../store/roomSocketStore');

function joinRoom(docId, socket, user) {
  // TODO: coordinate socket registration and room user upsert.
  return { docId, socket, user };
}

function leaveRoom(socket) {
  // TODO: remove runtime room context and return affected docId.
  return roomSocketStore.removeSocket(socket);
}

function getRoomUsers(docId) {
  return roomUserStore.getRoomUsers(docId);
}

function getRoomSockets(docId) {
  return roomSocketStore.getRoomSockets(docId);
}

module.exports = {
  joinRoom,
  leaveRoom,
  getRoomUsers,
  getRoomSockets,
};




