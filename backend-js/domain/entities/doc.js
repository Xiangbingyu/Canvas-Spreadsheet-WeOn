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

function createEmptyDocSnapshot(docId = null) {
  const normalizedDocId = typeof docId === 'string' && docId ? docId : 'new';

  return {
    id: `sheet_${normalizedDocId}_001`,
    name: 'Sheet1',
    defaultRowHeight: 25,
    defaultColWidth: 100,
    cells: {},
    styles: {},
    rowCount: 0,
    colCount: 0,
  };
}

function normalizeSnapshotObjectField(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return cloneJsonValue(value) || {};
}

function normalizeSnapshotCell(key, value) {
  const [rowPart, colPart] = String(key).split(':');
  const fallbackRow = Number.isInteger(Number(rowPart)) ? Number(rowPart) : 0;
  const fallbackCol = Number.isInteger(Number(colPart)) ? Number(colPart) : 0;
  const cell = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return {
    row: Number.isInteger(cell.row) ? cell.row : fallbackRow,
    col: Number.isInteger(cell.col) ? cell.col : fallbackCol,
    value: cell.value ?? '',
    styleId: typeof cell.styleId === 'string' ? cell.styleId : null,
  };
}

function normalizeSnapshotCells(cells) {
  const rawCells = normalizeSnapshotObjectField(cells);
  const normalizedCells = {};

  for (const [key, value] of Object.entries(rawCells)) {
    normalizedCells[key] = normalizeSnapshotCell(key, value);
  }

  return normalizedCells;
}

function normalizeDocSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return createEmptyDocSnapshot(options.docId);
  }

  const emptySnapshot = createEmptyDocSnapshot(options.docId);

  return {
    id: typeof snapshot.id === 'string' && snapshot.id ? snapshot.id : emptySnapshot.id,
    name: typeof snapshot.name === 'string' && snapshot.name ? snapshot.name : emptySnapshot.name,
    defaultRowHeight: Number.isInteger(snapshot.defaultRowHeight) ? snapshot.defaultRowHeight : emptySnapshot.defaultRowHeight,
    defaultColWidth: Number.isInteger(snapshot.defaultColWidth) ? snapshot.defaultColWidth : emptySnapshot.defaultColWidth,
    cells: normalizeSnapshotCells(snapshot.cells),
    styles: normalizeSnapshotObjectField(snapshot.styles),
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
    snapshotJson: normalizeDocSnapshot(snapshotJson || snapshot, { docId }),
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
