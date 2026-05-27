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

function createUserOpState({
  id = null,
  docId = null,
  clientId = null,
  undoStackJson = null,
  redoStackJson = null,
  undoStack = null,
  redoStack = null,
  updatedAt,
} = {}) {
  return {
    id,
    docId,
    clientId,
    undoStackJson: cloneJsonValue(undoStackJson !== null ? undoStackJson : (undoStack || [])) || [],
    redoStackJson: cloneJsonValue(redoStackJson !== null ? redoStackJson : (redoStack || [])) || [],
    updatedAt: toDateTimeString(updatedAt),
  };
}

module.exports = {
  createUserOpState,
};
