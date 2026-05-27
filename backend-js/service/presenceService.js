const roomUserStore = require('../store/roomUserStore');

function getPresence(docId) {
  return roomUserStore.getRoomUsers(docId).then((users) => ({
    docId,
    users,
  }));
}

module.exports = {
  getPresence,
};
