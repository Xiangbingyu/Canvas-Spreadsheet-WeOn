function createEventIdStore() {
  const processedEvents = new Map();

  return {
    processedEvents,

    has(eventId) {
      return processedEvents.has(eventId);
    },

    get(eventId) {
      return processedEvents.get(eventId) || null;
    },

    set(eventId, record) {
      processedEvents.set(eventId, record);
    },
  };
}

module.exports = createEventIdStore();
