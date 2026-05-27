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

function createEmptyDocSnapshot() {
  return {
    cells: {},
    styles: {},
    rowCount: 0,
    colCount: 0,
  };
}

function normalizeDocSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return createEmptyDocSnapshot();
  }

  return {
    cells: cloneJsonValue(snapshot.cells) || {},
    styles: cloneJsonValue(snapshot.styles) || {},
    rowCount: Number.isInteger(snapshot.rowCount) ? snapshot.rowCount : 0,
    colCount: Number.isInteger(snapshot.colCount) ? snapshot.colCount : 0,
  };
}

function createDoc({
  id = null,
  docId = null,
  title = 'Untitled',
  snapshotJson = null,
  snapshot = null,
  currentSeq = 0,
  seq = null,
  createdBy = null,
  createdAt,
  updatedAt,
} = {}) {
  const normalizedCreatedAt = toDateTimeString(createdAt);

  return {
    id,
    docId,
    title,
    snapshotJson: normalizeDocSnapshot(snapshotJson || snapshot),
    currentSeq: Number.isInteger(seq) ? seq : (Number.isInteger(currentSeq) ? currentSeq : 0),
    createdBy,
    createdAt: normalizedCreatedAt,
    updatedAt: toDateTimeString(updatedAt || normalizedCreatedAt),
  };
}

module.exports = {
  createDoc,
  createEmptyDocSnapshot,
  normalizeDocSnapshot,
};
