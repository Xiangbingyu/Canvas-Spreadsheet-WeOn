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

function createRoomSocket({
  id = null,
  docId = null,
  clientId = null,
  connectionId = null,
  serverId = null,
  status = 'connected',
  connectedAt,
  lastActiveAt,
} = {}) {
  const normalizedConnectedAt = toDateTimeString(connectedAt);

  return {
    id,
    docId,
    clientId,
    connectionId,
    serverId,
    status,
    connectedAt: normalizedConnectedAt,
    lastActiveAt: toDateTimeString(lastActiveAt || normalizedConnectedAt),
  };
}

module.exports = {
  createRoomSocket,
};
