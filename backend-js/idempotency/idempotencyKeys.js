function createDocRequestKey(eventId) {
  return eventId ? `doc:${eventId}` : null;
}

function createJoinRequestKey(eventId) {
  return eventId ? `join:${eventId}` : null;
}

module.exports = {
  createDocRequestKey,
  createJoinRequestKey,
};
