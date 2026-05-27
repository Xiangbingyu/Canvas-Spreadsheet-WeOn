function docStateKey(docId) {
  return `doc:${docId}:state`;
}

function roomUsersKey(docId) {
  return `room:${docId}:users`;
}

module.exports = {
  docStateKey,
  roomUsersKey,
};
