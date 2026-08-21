const XLSX = require('xlsx-js-style');

const docsService = require('./docsService');
const { styleToXlsxCellStyle } = require('./excelExportStyle');
const { ERROR_CODES } = require('../protocol/errorCodes');

const MAX_SHEET_NAME_LEN = 31;
const INVALID_SHEET_NAME_CHARS = /[:\\/?*[\]]/g;
const INVALID_FILE_NAME_CHARS = new Set('<>:"/\\|?*');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

/** Excel 工作表名：最长 31，去掉非法字符 */
function sanitizeExcelSheetName(name, fallback) {
  const trimmed = String(name || fallback).replace(INVALID_SHEET_NAME_CHARS, '_').trim();
  const base = trimmed || fallback;
  return base.length > MAX_SHEET_NAME_LEN ? base.slice(0, MAX_SHEET_NAME_LEN) : base;
}

function isInvalidFileNameChar(ch) {
  const code = ch.charCodeAt(0);
  return code < 32 || INVALID_FILE_NAME_CHARS.has(ch);
}

/** 文档标题 → 安全文件名（不含扩展名） */
function sanitizeExcelFileName(title) {
  const trimmed = String(title || '未命名表格').trim() || '未命名表格';
  const safe = [...trimmed]
    .map((ch) => (isInvalidFileNameChar(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return safe || '未命名表格';
}

function resolveCellStyle(sheet, cell) {
  if (!cell.styleId) return undefined;
  return styleToXlsxCellStyle(sheet.styles[cell.styleId]);
}

function computeUsedBounds(sheet) {
  let maxRow = 0;
  let maxCol = 0;
  for (const cell of Object.values(sheet.cells || {})) {
    maxRow = Math.max(maxRow, cell.row);
    maxCol = Math.max(maxCol, cell.col);
  }
  return { maxRow, maxCol };
}

function worksheetSnapshotToXlsxSheet(sheet) {
  const ws = {};
  const { maxRow, maxCol } = computeUsedBounds(sheet);

  if (maxRow === 0 || maxCol === 0) {
    ws['!ref'] = 'A1';
    return ws;
  }

  for (const cell of Object.values(sheet.cells || {})) {
    const addr = XLSX.utils.encode_cell({ r: cell.row - 1, c: cell.col - 1 });
    const xlsxCell = {
      t: 's',
      v: cell.value ?? '',
    };
    const cellStyle = resolveCellStyle(sheet, cell);
    if (cellStyle) {
      xlsxCell.s = cellStyle;
    }
    ws[addr] = xlsxCell;
  }

  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow - 1, c: maxCol - 1 },
  });

  if (sheet.defaultColWidth) {
    ws['!cols'] = Array.from({ length: maxCol }, () => ({
      wch: Math.max(8, Math.round(sheet.defaultColWidth / 7)),
    }));
  }

  return ws;
}

function buildXlsxWorkbook(sheetOrder, sheets) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  for (let i = 0; i < sheetOrder.length; i += 1) {
    const sheetId = sheetOrder[i];
    const sheet = sheets[sheetId];
    if (!sheet) continue;

    const sheetLabel = sheet.name || sheet.sheetName || `Sheet${i + 1}`;
    let name = sanitizeExcelSheetName(sheetLabel, `Sheet${i + 1}`);
    let suffix = 1;
    while (usedNames.has(name)) {
      const tail = `_${suffix}`;
      name = sanitizeExcelSheetName(
        `${sheetLabel}${tail}`.slice(0, MAX_SHEET_NAME_LEN),
        `Sheet${i + 1}`,
      );
      suffix += 1;
    }
    usedNames.add(name);

    XLSX.utils.book_append_sheet(wb, worksheetSnapshotToXlsxSheet(sheet), name);
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(
      wb,
      worksheetSnapshotToXlsxSheet({
        id: 'empty',
        name: 'Sheet1',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        rowCount: 1000,
        colCount: 1000,
        styles: {},
        cells: {},
      }),
      'Sheet1',
    );
  }

  return wb;
}

function xlsxWorkbookToBuffer(wb) {
  const out = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true,
  });
  const bytes = out instanceof Uint8Array ? out : new Uint8Array(out);
  return Buffer.from(bytes);
}

function normalizeExportScope(scope) {
  if (scope === 'current' || scope === 'all') {
    return scope;
  }
  return 'all';
}

function pickSheetsForExport(snapshot, scope, activeSheetId) {
  const sheetOrder = Array.isArray(snapshot.sheetOrder) ? snapshot.sheetOrder : [];
  const sheets = snapshot.sheets && typeof snapshot.sheets === 'object' ? snapshot.sheets : {};

  if (scope === 'all') {
    return { sheetOrder, sheets };
  }

  const activeId = typeof activeSheetId === 'string' && activeSheetId ? activeSheetId : snapshot.activeSheetId;
  const sheet = activeId ? sheets[activeId] : null;
  if (!sheet) {
    return { sheetOrder: [], sheets: {} };
  }

  return { sheetOrder: [activeId], sheets: { [activeId]: sheet } };
}

async function exportDocToExcel(docId, options = {}) {
  const doc = await docsService.getDocState(docId);
  const scope = normalizeExportScope(options.scope);
  const { sheetOrder, sheets } = pickSheetsForExport(doc.snapshot, scope, options.activeSheetId);
  const wb = buildXlsxWorkbook(sheetOrder, sheets);
  const buffer = xlsxWorkbookToBuffer(wb);
  const fileName = `${sanitizeExcelFileName(doc.title)}.xlsx`;

  return { buffer, fileName };
}

function validateExportQuery(query = {}) {
  const scope = normalizeExportScope(query.scope);
  const activeSheetId = typeof query.activeSheetId === 'string' && query.activeSheetId.trim()
    ? query.activeSheetId.trim()
    : undefined;

  if (scope === 'current' && !activeSheetId) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'activeSheetId is required when scope is current');
  }

  return { scope, activeSheetId };
}

module.exports = {
  exportDocToExcel,
  validateExportQuery,
  sanitizeExcelFileName,
};
