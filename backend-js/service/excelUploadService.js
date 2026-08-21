const fs = require('fs/promises');
const path = require('path');
const XLSX = require('xlsx');

const docsService = require('./docsService');

const DEFAULT_ROW_COUNT = 1000;
const DEFAULT_COL_COUNT = 1000;

function cellValueToString(value) {
  if (value == null) {
    return '';
  }
  return String(value);
}

function deriveTitleFromFileName(fileName) {
  const base = path.basename(fileName, path.extname(fileName)).trim();
  return base || 'Untitled';
}

function buildSnapshotFromWorkbook(workbook) {
  const sheets = {};
  const sheetOrder = [];

  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      return;
    }

    const sheetId = `import_${String(index + 1).padStart(3, '0')}`;
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });

    const cells = {};
    let maxRow = 0;
    let maxCol = 0;

    rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) {
        return;
      }

      row.forEach((value, colIndex) => {
        const text = cellValueToString(value).trim();
        if (!text) {
          return;
        }

        const rowNum = rowIndex + 1;
        const colNum = colIndex + 1;
        maxRow = Math.max(maxRow, rowNum);
        maxCol = Math.max(maxCol, colNum);
        cells[`${rowNum}:${colNum}`] = {
          row: rowNum,
          col: colNum,
          value: text,
        };
      });
    });

    sheets[sheetId] = {
      id: sheetId,
      name: sheetName || `Sheet${index + 1}`,
      defaultRowHeight: 25,
      defaultColWidth: 100,
      rowCount: Math.max(DEFAULT_ROW_COUNT, maxRow),
      colCount: Math.max(DEFAULT_COL_COUNT, maxCol),
      styles: {},
      cells,
    };
    sheetOrder.push(sheetId);
  });

  if (sheetOrder.length === 0) {
    throw new Error('no sheets found in workbook');
  }

  return {
    activeSheetId: sheetOrder[0],
    sheetOrder,
    sheets,
  };
}

async function createDocFromMergedFile(input = {}) {
  const { mergedPath, fileName, createdBy, title, eventId } = input;

  const buffer = await fs.readFile(mergedPath);
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellText: true,
  });

  const snapshot = buildSnapshotFromWorkbook(workbook);
  const doc = await docsService.createDoc({
    title: title || deriveTitleFromFileName(fileName),
    createdBy: createdBy || null,
    snapshot,
    eventId: eventId || null,
  });

  return doc.docId;
}

module.exports = {
  buildSnapshotFromWorkbook,
  createDocFromMergedFile,
};
