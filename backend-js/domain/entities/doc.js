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

function buildDefaultSheetId(docId = null) {
  const normalizedDocId = typeof docId === 'string' && docId ? docId : 'new';
  return `sheet_${normalizedDocId}_001`;
}

function buildSheetIdPrefix(docId = null) {
  const normalizedDocId = typeof docId === 'string' && docId ? docId : 'new';
  return `sheet_${normalizedDocId}`;
}

function buildSheetIdWithSequence(docId = null, sequence = 1) {
  const normalizedSequence = Number.isInteger(sequence) && sequence > 0 ? sequence : 1;
  return `${buildSheetIdPrefix(docId)}_${String(normalizedSequence).padStart(3, '0')}`;
}

function buildNextSheetId(snapshot, docId = null) {
  const normalizedSnapshot = normalizeWorkbookSnapshot(snapshot, { docId });
  const existingSheetIds = new Set(Object.keys(normalizedSnapshot.sheets || {}));
  const prefix = `${buildSheetIdPrefix(docId)}_`;
  let maxSequence = 0;

  for (const sheetId of existingSheetIds) {
    if (!sheetId.startsWith(prefix)) {
      continue;
    }

    const suffix = sheetId.slice(prefix.length);
    const numericValue = Number.parseInt(suffix, 10);
    if (Number.isInteger(numericValue) && numericValue > maxSequence) {
      maxSequence = numericValue;
    }
  }

  let nextSequence = Math.max(maxSequence + 1, existingSheetIds.size + 1, 1);
  let candidate = buildSheetIdWithSequence(docId, nextSequence);

  while (existingSheetIds.has(candidate)) {
    nextSequence += 1;
    candidate = buildSheetIdWithSequence(docId, nextSequence);
  }

  return candidate;
}

function buildDefaultSheetName(snapshot) {
  const normalizedSnapshot = normalizeWorkbookSnapshot(snapshot);
  const existingNames = new Set(
    Object.values(normalizedSnapshot.sheets || {})
      .map((sheet) => (sheet && typeof sheet.name === 'string' ? sheet.name : ''))
      .filter(Boolean)
  );

  let nextSequence = Math.max((normalizedSnapshot.sheetOrder || []).length + 1, 1);
  let candidate = `Sheet${nextSequence}`;

  while (existingNames.has(candidate)) {
    nextSequence += 1;
    candidate = `Sheet${nextSequence}`;
  }

  return candidate;
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

function createEmptySheetSnapshot(options = {}) {
  const {
    docId = null,
    sheetId = null,
    name = 'Sheet1',
  } = options;
  const resolvedSheetId = typeof sheetId === 'string' && sheetId
    ? sheetId
    : buildDefaultSheetId(docId);

  return {
    id: resolvedSheetId,
    name,
    defaultRowHeight: 25,
    defaultColWidth: 100,
    cells: {},
    styles: {},
    rowCount: 0,
    colCount: 0,
  };
}

function normalizeSheetSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return createEmptySheetSnapshot(options);
  }

  const emptySheet = createEmptySheetSnapshot({
    docId: options.docId,
    sheetId: options.sheetId || snapshot.id,
    name: options.name || snapshot.name || 'Sheet1',
  });

  return {
    id: typeof options.sheetId === 'string' && options.sheetId
      ? options.sheetId
      : (typeof snapshot.id === 'string' && snapshot.id ? snapshot.id : emptySheet.id),
    name: typeof snapshot.name === 'string' && snapshot.name ? snapshot.name : emptySheet.name,
    defaultRowHeight: Number.isInteger(snapshot.defaultRowHeight) ? snapshot.defaultRowHeight : emptySheet.defaultRowHeight,
    defaultColWidth: Number.isInteger(snapshot.defaultColWidth) ? snapshot.defaultColWidth : emptySheet.defaultColWidth,
    cells: normalizeSnapshotCells(snapshot.cells),
    styles: normalizeSnapshotObjectField(snapshot.styles),
    rowCount: Number.isInteger(snapshot.rowCount) ? snapshot.rowCount : emptySheet.rowCount,
    colCount: Number.isInteger(snapshot.colCount) ? snapshot.colCount : emptySheet.colCount,
  };
}

function isLegacySheetSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return false;
  }

  return !snapshot.sheets
    && (
      typeof snapshot.id === 'string'
      || typeof snapshot.name === 'string'
      || snapshot.cells !== undefined
      || snapshot.styles !== undefined
    );
}

function normalizeSheetCollection(sheets, options = {}) {
  const rawSheets = normalizeSnapshotObjectField(sheets);
  const normalizedSheets = {};

  for (const [sheetKey, sheetValue] of Object.entries(rawSheets)) {
    const normalizedSheet = normalizeSheetSnapshot(sheetValue, {
      docId: options.docId,
      sheetId: sheetKey,
    });
    normalizedSheets[normalizedSheet.id] = normalizedSheet;
  }

  return normalizedSheets;
}

function normalizeSheetOrder(sheetOrder, sheets) {
  const existingSheetIds = Object.keys(sheets);
  const validSheetIds = new Set(existingSheetIds);
  const normalizedOrder = [];

  if (Array.isArray(sheetOrder)) {
    for (const sheetId of sheetOrder) {
      if (typeof sheetId !== 'string' || !validSheetIds.has(sheetId) || normalizedOrder.includes(sheetId)) {
        continue;
      }

      normalizedOrder.push(sheetId);
    }
  }

  for (const sheetId of existingSheetIds) {
    if (!normalizedOrder.includes(sheetId)) {
      normalizedOrder.push(sheetId);
    }
  }

  return normalizedOrder;
}

function createEmptyWorkbookSnapshot(docId = null) {
  const defaultSheet = createEmptySheetSnapshot({ docId });

  return {
    activeSheetId: defaultSheet.id,
    sheetOrder: [defaultSheet.id],
    sheets: {
      [defaultSheet.id]: defaultSheet,
    },
  };
}

function normalizeWorkbookSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return createEmptyWorkbookSnapshot(options.docId);
  }

  if (isLegacySheetSnapshot(snapshot)) {
    const legacySheet = normalizeSheetSnapshot(snapshot, { docId: options.docId });

    return {
      activeSheetId: legacySheet.id,
      sheetOrder: [legacySheet.id],
      sheets: {
        [legacySheet.id]: legacySheet,
      },
    };
  }

  let normalizedSheets = normalizeSheetCollection(snapshot.sheets, { docId: options.docId });

  if (Object.keys(normalizedSheets).length === 0) {
    return createEmptyWorkbookSnapshot(options.docId);
  }

  const normalizedSheetOrder = normalizeSheetOrder(snapshot.sheetOrder, normalizedSheets);
  const fallbackActiveSheetId = normalizedSheetOrder[0];
  const normalizedActiveSheetId = (
    typeof snapshot.activeSheetId === 'string'
    && normalizedSheets[snapshot.activeSheetId]
  )
    ? snapshot.activeSheetId
    : fallbackActiveSheetId;

  return {
    activeSheetId: normalizedActiveSheetId,
    sheetOrder: normalizedSheetOrder,
    sheets: normalizedSheets,
  };
}

function normalizeDocSnapshot(snapshot, options = {}) {
  return normalizeWorkbookSnapshot(snapshot, options);
}

function createEmptyDocSnapshot(docId = null) {
  return createEmptyWorkbookSnapshot(docId);
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
  buildDefaultSheetId,
  buildNextSheetId,
  buildDefaultSheetName,
  createEmptyWorkbookSnapshot,
  createEmptySheetSnapshot,
  createEmptyDocSnapshot,
  normalizeSheetSnapshot,
  normalizeWorkbookSnapshot,
  normalizeDocSnapshot,
};
