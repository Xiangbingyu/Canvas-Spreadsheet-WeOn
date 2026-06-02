const auditLogStore = require('../store/auditLogStore');
const realtimeConfig = require('../config/realtimeConfig');

function normalizeAuditEvent(event = {}) {
  const {
    type,
    eventType,
    docId = null,
    clientId = null,
    createdBy = null,
    requestId = null,
    eventId = null,
    payload,
    ...payloadFields
  } = event;

  return {
    eventType: eventType || type || 'unknown',
    docId,
    clientId: clientId || createdBy || null,
    requestId: requestId || eventId || null,
    payloadJson: payload || payloadFields,
  };
}

async function recordAuditEvent(event) {
  const normalizedEvent = normalizeAuditEvent(event);

  if (realtimeConfig.driver === 'redis') {
    setImmediate(async () => {
      try {
        await auditLogStore.append(normalizedEvent);
      } catch (error) {
        console.error('async audit append failed:', error);
      }
    });

    return {
      status: 'queued',
      event: normalizedEvent,
    };
  }

  const record = await auditLogStore.append(normalizedEvent);

  return {
    status: 'persisted',
    event: record,
  };
}

module.exports = {
  recordAuditEvent,
};
