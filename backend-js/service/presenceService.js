const roomUserStore = require('../store/roomUserStore');

function getPresence(docId) {
  return {
    docId,
    users: roomUserStore.getRoomUsers(docId),
  };
}

module.exports = {
  getPresence,
};


