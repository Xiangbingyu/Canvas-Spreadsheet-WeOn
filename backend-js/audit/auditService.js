function recordAuditEvent(event) {
  // TODO: phase 2 can persist these events to database or message queue.
  return {
    status: 'skipped',
    event,
  };
}

module.exports = {
  recordAuditEvent,
};
