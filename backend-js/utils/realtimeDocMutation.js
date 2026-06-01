const {
  normalizeDocSnapshot,
  createEmptySheetSnapshot,
  buildNextSheetId,
  buildDefaultSheetName,
} = require('../domain/entities/doc');
const { applySheetStructureChangeToSnapshot } = require('./sheetStructure');

function cloneJsonValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function createStyleKey(style) {
  return stableStringify(style);
}

function nextStyleId(sheet) {
  const existingIds = Object.keys(sheet.styles || {});
  let maxStyleNumber = 0;

  for (const id of existingIds) {
    const match = /^style_(\d+)$/.exec(id);
    if (match) {
      maxStyleNumber = Math.max(maxStyleNumber, Number(match[1]));
    }
  }

  return `style_${String(maxStyleNumber + 1).padStart(3, '0')}`;
}

function findOrCreateStyleId(sheet, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return null;
  }

  const styleKey = createStyleKey(style);

  for (const [styleId, styleValue] of Object.entries(sheet.styles || {})) {
    if (createStyleKey(styleValue) === styleKey) {
      return styleId;
    }
  }

  const styleId = nextStyleId(sheet);
  sheet.styles[styleId] = cloneJsonValue(style);
  return styleId;
}

function resolveTargetSheet(nextSnapshot, preferredSheetId = null) {
  const requestedSheetId = typeof preferredSheetId === 'string' && preferredSheetId
    ? preferredSheetId
    : nextSnapshot.activeSheetId;

  if (!requestedSheetId || !nextSnapshot.sheets || !nextSnapshot.sheets[requestedSheetId]) {
    return {
      sheetId: null,
      sheet: null,
    };
  }

  return {
    sheetId: requestedSheetId,
    sheet: nextSnapshot.sheets[requestedSheetId],
  };
}

function applySetCellToRealtimeDoc(currentDoc, command) {
  const nextSnapshot = normalizeDocSnapshot(currentDoc.snapshotJson, { docId: command.docId });
  const { sheetId: targetSheetId, sheet: targetSheet } = resolveTargetSheet(nextSnapshot, command.sheetId);

  if (!targetSheetId || !targetSheet) {
    return null;
  }

  const cellKey = `${command.row}:${command.col}`;
  const previousCell = targetSheet.cells[cellKey] || {};
  const oldValue = previousCell.value ?? '';
  const oldStyleId = typeof previousCell.styleId === 'string' ? previousCell.styleId : null;
  const oldStyle = oldStyleId ? cloneJsonValue(targetSheet.styles[oldStyleId] || null) : null;
  const nextStyleIdValue = command.style !== undefined
    ? findOrCreateStyleId(targetSheet, command.style)
    : null;

  targetSheet.cells[cellKey] = {
    row: command.row,
    col: command.col,
    value: command.value ?? '',
    styleId: nextStyleIdValue,
  };

  if (command.row > targetSheet.rowCount) {
    targetSheet.rowCount = command.row;
  }

  if (command.col > targetSheet.colCount) {
    targetSheet.colCount = command.col;
  }

  return {
    nextSnapshot,
    targetSheetId,
    beforeState: {
      value: oldValue,
      style: oldStyle,
    },
  };
}

module.exports = {
  cloneJsonValue,
  applySetCellToRealtimeDoc,
  applyAddSheetToRealtimeDoc(currentDoc, command = {}) {
    const nextSnapshot = normalizeDocSnapshot(currentDoc.snapshotJson, { docId: command.docId });
    const nextSheetId = buildNextSheetId(nextSnapshot, command.docId);
    const nextSheet = createEmptySheetSnapshot({
      docId: command.docId,
      sheetId: nextSheetId,
      name: command.sheetName || buildDefaultSheetName(nextSnapshot),
    });

    nextSnapshot.sheets[nextSheetId] = nextSheet;
    nextSnapshot.sheetOrder = [...(nextSnapshot.sheetOrder || []), nextSheetId];
    nextSnapshot.activeSheetId = nextSheetId;

    return {
      nextSnapshot,
      addedSheet: cloneJsonValue(nextSheet),
    };
  },
  applyImportSheetToRealtimeDoc(command = {}) {
    return normalizeDocSnapshot(command.snapshotJson || command.snapshot, { docId: command.docId });
  },
  applySheetStructureChangeToRealtimeDoc(currentDoc, command = {}) {
    return applySheetStructureChangeToSnapshot(currentDoc.snapshotJson, command);
  },
};
