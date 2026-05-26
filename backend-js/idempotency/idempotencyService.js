const eventIdStore = require('./eventIdStore');

function isProcessed(eventId) {
  if (!eventId) {
    return false;
  }

  return eventIdStore.has(eventId);
}

function remember(eventId, record) {
  if (!eventId) {
    return;
  }

  eventIdStore.set(eventId, record);
}

module.exports = {
  isProcessed,
  remember,
};
