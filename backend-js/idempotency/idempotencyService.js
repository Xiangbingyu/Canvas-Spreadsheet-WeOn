const eventIdStore = require('./eventIdStore');

function isProcessed(eventId) {
  if (!eventId) {
    return false;
  }

  return eventIdStore.has(eventId);
}

function getRemembered(eventId) {
  if (!eventId) {
    return null;
  }

  return eventIdStore.get(eventId);
}

function remember(eventId, record) {
  if (!eventId) {
    return;
  }

  eventIdStore.set(eventId, record);
}

module.exports = {
  isProcessed,
  getRemembered,
  remember,
};
