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

function createHistory({
  id = null,
  docId = null,
  seq = 0,
  baseSeq = null,
  clientId = null,
  opType = 'unknown',
  targetSheetId = null,
  targetRow = null,
  targetCol = null,
  oldValueJson = null,
  newValueJson = null,
  oldStyleJson = null,
  newStyleJson = null,
  payloadJson = null,
  payload = null,
  sourceSeq = null,
  eventId = null,
  createdAt,
} = {}) {
  return {
    id,
    docId,
    seq: Number.isInteger(seq) ? seq : 0,
    baseSeq: Number.isInteger(baseSeq) ? baseSeq : null,
    clientId,
    opType,
    targetSheetId: typeof targetSheetId === 'string' && targetSheetId ? targetSheetId : null,
    targetRow: Number.isInteger(targetRow) ? targetRow : null,
    targetCol: Number.isInteger(targetCol) ? targetCol : null,
    oldValueJson: cloneJsonValue(oldValueJson),
    newValueJson: cloneJsonValue(newValueJson),
    oldStyleJson: cloneJsonValue(oldStyleJson),
    newStyleJson: cloneJsonValue(newStyleJson),
    payloadJson: cloneJsonValue(payloadJson !== null ? payloadJson : payload),
    sourceSeq: Number.isInteger(sourceSeq) ? sourceSeq : null,
    eventId,
    createdAt: toDateTimeString(createdAt),
  };
}

module.exports = {
  createHistory,
};
