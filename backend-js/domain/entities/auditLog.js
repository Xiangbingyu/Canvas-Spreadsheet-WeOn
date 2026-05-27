function cloneJsonValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function toDateTimeString(value = new Date()) {
  if (typeof value === 'string' && value) {
    return value;
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date().toISOString();
}

function createAuditLog({
  id = null,
  eventType = 'unknown',
  docId = null,
  clientId = null,
  requestId = null,
  payloadJson = null,
  payload = null,
  createdAt,
} = {}) {
  return {
    id,
    eventType,
    docId,
    clientId,
    requestId,
    payloadJson: cloneJsonValue(payloadJson !== null ? payloadJson : payload),
    createdAt: toDateTimeString(createdAt),
  };
}

module.exports = {
  createAuditLog,
};
