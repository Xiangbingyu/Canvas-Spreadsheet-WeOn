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

function createRoomUser({
  id = null,
  docId = null,
  clientId = null,
  name = '',
  color = '#3b82f6',
  status = 'online',
  joinedAt,
  lastActiveAt,
} = {}) {
  const normalizedJoinedAt = toDateTimeString(joinedAt);

  return {
    id,
    docId,
    clientId,
    name,
    color,
    status,
    joinedAt: normalizedJoinedAt,
    lastActiveAt: toDateTimeString(lastActiveAt || normalizedJoinedAt),
  };
}

module.exports = {
  createRoomUser,
};
