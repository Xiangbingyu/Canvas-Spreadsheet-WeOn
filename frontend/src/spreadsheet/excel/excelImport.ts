import * as XLSX from 'xlsx'
import type { WorksheetData } from '@/spreadsheet/model/types'
import { a1ToRowCol } from '@/spreadsheet/utils/coordinates'

type ParseExcelResult = WorksheetData | null
type XlsxCell = { v?: unknown; w?: unknown }

/**
 * 将 Excel 文件的二进制内容解析为首个工作表。
 *
 * @param buffer - 由 `file.arrayBuffer()` 得到的 ArrayBuffer
 * @returns 成功返回 WorksheetData；无有效工作表时返回 null
 */
export function parseExcelFromArrayBuffer(buffer: ArrayBuffer): ParseExcelResult {
  if (!buffer.byteLength) {
    return null
  }
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]
  if (!worksheet) {
    return null
  }

  const cells: WorksheetData['cells'] = {}
  let maxRow = 0
  let maxCol = 0

  for (const key of Object.keys(worksheet)) {
    if (key.startsWith('!')) continue
    const rc = a1ToRowCol(key)
    if (!rc) continue

    const cellObj = (worksheet as Record<string, unknown>)[key] as XlsxCell | undefined
    const raw = cellObj?.w ?? cellObj?.v
    const value = raw == null ? '' : String(raw)
    if (value === '') continue

    maxRow = Math.max(maxRow, rc.row)
    maxCol = Math.max(maxCol, rc.col)

    const mapKey = `${rc.row}:${rc.col}`
    cells[mapKey] = { row: rc.row, col: rc.col, value }
  }

  const DEFAULT_ROW_COUNT = 20
  const DEFAULT_COL_COUNT = 10

  let parsedRow = 0
  let parsedCol = 0
  const ref = worksheet['!ref']
  if (ref) {
    const range = XLSX.utils.decode_range(ref)
    parsedRow = range.e.r - range.s.r + 1
    parsedCol = range.e.c - range.s.c + 1
  } else if (maxRow > 0 && maxCol > 0) {
    parsedRow = maxRow
    parsedCol = maxCol
  }

  const rowCount = Math.max(DEFAULT_ROW_COUNT, parsedRow)
  const colCount = Math.max(DEFAULT_COL_COUNT, parsedCol)

  return {
    id: '01',
    name: firstSheetName ?? 'Sheet1',
    defaultRowHeight: 25,
    defaultColWidth: 100,
    rowCount,
    colCount,
    styles: {},
    cells,
  }
}
