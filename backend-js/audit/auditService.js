const auditLogStore = require('../store/auditLogStore');

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
  const record = await auditLogStore.append(normalizeAuditEvent(event));

  return {
    status: 'persisted',
    event: record,
  };
}

module.exports = {
  recordAuditEvent,
};
