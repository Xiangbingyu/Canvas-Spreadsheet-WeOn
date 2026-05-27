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

  for (const key of Object.keys(worksheet)) {
    if (key.startsWith('!')) continue
    const rc = a1ToRowCol(key)
    if (!rc) continue

    const cellObj = (worksheet as Record<string, unknown>)[key] as XlsxCell | undefined
    const raw = cellObj?.w ?? cellObj?.v
    const value = raw == null ? '' : String(raw)
    if (value === '') continue

    const mapKey = `${rc.row}:${rc.col}`
    cells[mapKey] = { row: rc.row, col: rc.col, value }
  }

  return {
    id: '01',
    name: firstSheetName ?? 'Sheet1',
    defaultRowHeight: 25,
    defaultColWidth: 100,
    styles: {},
    cells,
  }
}
