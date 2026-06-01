const { normalizeDocSnapshot } = require('../domain/entities/doc');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
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

function getPositionField(opType) {
  return opType.endsWith('_row') ? 'row' : 'col';
}

function validateSheetStructureChange(snapshot, {
  docId = null,
  sheetId,
  opType,
  row = null,
  col = null,
} = {}) {
  const nextSnapshot = normalizeDocSnapshot(snapshot, { docId });
  const { sheetId: targetSheetId, sheet: targetSheet } = resolveTargetSheet(nextSnapshot, sheetId);

  if (!targetSheetId || !targetSheet) {
    return {
      ok: false,
      reason: 'sheet_not_found',
      nextSnapshot,
      targetSheetId: null,
      targetSheet: null,
    };
  }

  const positionField = getPositionField(opType);
  const positionValue = positionField === 'row' ? row : col;

  if (!isPositiveInteger(positionValue)) {
    return {
      ok: false,
      reason: 'invalid_position',
      nextSnapshot,
      targetSheetId,
      targetSheet,
      positionField,
      positionValue,
    };
  }

  const upperBound = (
    opType === 'insert_row'
    || opType === 'insert_col'
  )
    ? (positionField === 'row' ? targetSheet.rowCount : targetSheet.colCount) + 1
    : (positionField === 'row' ? targetSheet.rowCount : targetSheet.colCount);

  if (positionValue < 1 || positionValue > upperBound) {
    return {
      ok: false,
      reason: 'position_out_of_range',
      nextSnapshot,
      targetSheetId,
      targetSheet,
      positionField,
      positionValue,
      upperBound,
    };
  }

  return {
    ok: true,
    nextSnapshot,
    targetSheetId,
    targetSheet,
    positionField,
    positionValue,
    upperBound,
  };
}

function applySheetStructureChangeToSnapshot(snapshot, command = {}) {
  const validation = validateSheetStructureChange(snapshot, command);

  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      nextSnapshot: validation.nextSnapshot,
      targetSheetId: validation.targetSheetId || null,
      positionField: validation.positionField || getPositionField(command.opType || 'insert_row'),
      positionValue: validation.positionValue ?? null,
      upperBound: validation.upperBound ?? null,
    };
  }

  const {
    nextSnapshot,
    targetSheetId,
    targetSheet,
    positionField,
    positionValue,
  } = validation;
  const newCells = {};

  for (const cell of Object.values(targetSheet.cells || {})) {
    if (!cell || typeof cell !== 'object') {
      continue;
    }

    const nextCell = { ...cell };

    if (command.opType === 'insert_row') {
      if (nextCell.row >= positionValue) {
        nextCell.row += 1;
      }
    } else if (command.opType === 'delete_row') {
      if (nextCell.row === positionValue) {
        continue;
      }
      if (nextCell.row > positionValue) {
        nextCell.row -= 1;
      }
    } else if (command.opType === 'insert_col') {
      if (nextCell.col >= positionValue) {
        nextCell.col += 1;
      }
    } else if (command.opType === 'delete_col') {
      if (nextCell.col === positionValue) {
        continue;
      }
      if (nextCell.col > positionValue) {
        nextCell.col -= 1;
      }
    }

    newCells[`${nextCell.row}:${nextCell.col}`] = nextCell;
  }

  targetSheet.cells = newCells;

  if (command.opType === 'insert_row') {
    targetSheet.rowCount += 1;
  } else if (command.opType === 'delete_row') {
    targetSheet.rowCount = Math.max(targetSheet.rowCount - 1, 0);
  } else if (command.opType === 'insert_col') {
    targetSheet.colCount += 1;
  } else if (command.opType === 'delete_col') {
    targetSheet.colCount = Math.max(targetSheet.colCount - 1, 0);
  }

  return {
    ok: true,
    nextSnapshot,
    targetSheetId,
    targetSheet,
    positionField,
    positionValue,
  };
}

module.exports = {
  validateSheetStructureChange,
  applySheetStructureChangeToSnapshot,
};
