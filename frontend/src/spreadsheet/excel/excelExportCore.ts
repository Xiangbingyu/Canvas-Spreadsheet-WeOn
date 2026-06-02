/**
 * Excel 导出核心：WorksheetData → xlsx-js-style WorkSheet（含样式）
 */
import * as XLSX from 'xlsx-js-style'
import type { Cell, WorksheetData } from '@/spreadsheet/model/types'
import { styleToXlsxCellStyle } from './excelExportStyle'

const MAX_SHEET_NAME_LEN = 31
const INVALID_SHEET_NAME_CHARS = /[:\\/?*[\]]/g

/** Excel 工作表名：最长 31，去掉非法字符 */
export function sanitizeExcelSheetName(name: string, fallback: string): string {
  const trimmed = (name || fallback).replace(INVALID_SHEET_NAME_CHARS, '_').trim()
  const base = trimmed || fallback
  return base.length > MAX_SHEET_NAME_LEN ? base.slice(0, MAX_SHEET_NAME_LEN) : base
}

const INVALID_FILE_NAME_CHARS = new Set('<>:"/\\|?*')

function isInvalidFileNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code < 32 || INVALID_FILE_NAME_CHARS.has(ch)
}

/** 文档标题 → 安全文件名（不含扩展名） */
export function sanitizeExcelFileName(title: string): string {
  const trimmed = (title || '未命名表格').trim() || '未命名表格'
  const safe = [...trimmed]
    .map((ch) => (isInvalidFileNameChar(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return safe || '未命名表格'
}

function resolveCellStyle(sheet: WorksheetData, cell: Cell) {
  if (!cell.styleId) return undefined
  return styleToXlsxCellStyle(sheet.styles[cell.styleId])
}

function computeUsedBounds(sheet: WorksheetData): { maxRow: number; maxCol: number } {
  let maxRow = 0
  let maxCol = 0
  for (const cell of Object.values(sheet.cells)) {
    maxRow = Math.max(maxRow, cell.row)
    maxCol = Math.max(maxCol, cell.col)
  }
  return { maxRow, maxCol }
}

/** 单张 WorksheetData → 带样式的 WorkSheet */
export function worksheetDataToXlsxSheet(sheet: WorksheetData): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const { maxRow, maxCol } = computeUsedBounds(sheet)

  if (maxRow === 0 || maxCol === 0) {
    ws['!ref'] = 'A1'
    return ws
  }

  for (const cell of Object.values(sheet.cells)) {
    const addr = XLSX.utils.encode_cell({ r: cell.row - 1, c: cell.col - 1 })
    const xlsxCell: XLSX.CellObject = {
      t: 's',
      v: cell.value,
    }
    const cellStyle = resolveCellStyle(sheet, cell)
    if (cellStyle) {
      ;(xlsxCell as XLSX.CellObject & { s?: unknown }).s = cellStyle
    }
    ws[addr] = xlsxCell
  }

  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow - 1, c: maxCol - 1 },
  })

  if (sheet.defaultColWidth) {
    ws['!cols'] = Array.from({ length: maxCol }, () => ({
      wch: Math.max(8, Math.round(sheet.defaultColWidth / 7)),
    }))
  }

  return ws
}

/** 多 sheet → xlsx WorkBook */
export function buildXlsxWorkbook(
  sheetOrder: string[],
  sheets: Record<string, WorksheetData>
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const usedNames = new Set<string>()

  for (let i = 0; i < sheetOrder.length; i++) {
    const sheetId = sheetOrder[i]
    const sheet = sheets[sheetId]
    if (!sheet) continue

    let name = sanitizeExcelSheetName(sheet.sheetName, `Sheet${i + 1}`)
    let suffix = 1
    while (usedNames.has(name)) {
      const tail = `_${suffix}`
      name = sanitizeExcelSheetName(
        `${sheet.sheetName}${tail}`.slice(0, MAX_SHEET_NAME_LEN),
        `Sheet${i + 1}`
      )
      suffix += 1
    }
    usedNames.add(name)

    XLSX.utils.book_append_sheet(wb, worksheetDataToXlsxSheet(sheet), name)
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(
      wb,
      worksheetDataToXlsxSheet({
        sheetId: 'empty',
        sheetName: 'Sheet1',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        rowCount: 1000,
        colCount: 1000,
        styles: {},
        cells: {},
      }),
      'Sheet1'
    )
  }

  return wb
}

/** WorkBook → ArrayBuffer（.xlsx） */
export function xlsxWorkbookToBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true,
  }) as ArrayBuffer | Uint8Array
  const bytes = out instanceof Uint8Array ? out : new Uint8Array(out)
  return bytes.slice().buffer
}
