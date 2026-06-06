/**
 * SheetJS 读取 Excel（仅 .xls）：只导入单元格值，不解析样式
 */

import * as XLSX from 'xlsx'
import type { WorkbookData, WorksheetData } from '@/spreadsheet/model/types'

const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000
const BUILD_CHUNK_ROWS = 200

type ParseProgressReporter = (progress: {
  phase: 'reading' | 'converting' | 'building' | 'done'
  percent: number
  message: string
}) => void

const SHEET_TO_JSON_OPTIONS: XLSX.Sheet2JSONOpts = {
  header: 1, // 输出数组行，不用首行当对象键名
  defval: '', // 空单元格填 ''
  raw: false, // 用格式化后的显示文本
  rawNumbers: false,
  blankrows: false,
  skipHidden: false,
}

const READ_WORKBOOK_OPTIONS: XLSX.ParsingOptions = {
  type: 'array',
  cellDates: false,
  cellText: true,
}

function cellValueToString(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function buildWorksheetFromRows(
  rows: unknown[][],
  sheetId: string,
  sheetName: string,
  reportProgress: ParseProgressReporter,
  progressBase: number,
  progressSpan: number
): WorksheetData {
  const cells: WorksheetData['cells'] = {}
  let maxRow = 0
  let maxCol = 0
  const totalRows = rows.length

  for (let r = 0; r < totalRows; r++) {
    const row = rows[r]
    if (!Array.isArray(row)) continue

    for (let c = 0; c < row.length; c++) {
      const value = cellValueToString(row[c]).trim()
      if (value === '') continue

      const rowNum = r + 1
      const colNum = c + 1
      maxRow = Math.max(maxRow, rowNum)
      maxCol = Math.max(maxCol, colNum)
      cells[`${rowNum}:${colNum}`] = { row: rowNum, col: colNum, value }
    }

    if (totalRows > 0 && (r % BUILD_CHUNK_ROWS === 0 || r === totalRows - 1)) {
      const ratio = (r + 1) / totalRows
      reportProgress({
        phase: 'building',
        percent: Math.round(progressBase + ratio * progressSpan),
        message: `正在写入「${sheetName}」${r + 1} / ${totalRows} 行…`,
      })
    }
  }

  const parsedRow = maxRow > 0 ? maxRow : totalRows
  return {
    sheetId,
    sheetName: sheetName || 'Sheet1',
    defaultRowHeight: 25,
    defaultColWidth: 100,
    rowCount: Math.max(DEFAULT_ROW_COUNT, parsedRow),
    colCount: Math.max(DEFAULT_COL_COUNT, maxCol),
    styles: {},
    cells,
  }
}

/** .xls buffer → WorkbookData（仅值） */
export function parseSheetJsBuffer(
  buffer: ArrayBuffer,
  reportProgress: ParseProgressReporter
): WorkbookData {
  reportProgress({
    phase: 'reading',
    percent: 5,
    message: '正在读取 .xls 工作簿（仅导入值）…',
  })

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, READ_WORKBOOK_OPTIONS)
  } catch {
    throw new Error('无法解析 .xls 文件，请确认文件未损坏')
  }

  const sheetNames = workbook.SheetNames
  if (sheetNames.length === 0) {
    throw new Error('未找到可导入的工作表')
  }

  const sheets: Record<string, WorksheetData> = {}
  const sheetOrder: string[] = []
  const totalSheets = sheetNames.length
  const sheetProgressStart = 15
  const sheetProgressEnd = 98

  for (let index = 0; index < totalSheets; index++) {
    const sheetName = sheetNames[index]
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) continue

    const sheetId = `import_${String(index + 1).padStart(3, '0')}`
    const progressBase =
      sheetProgressStart + (index / totalSheets) * (sheetProgressEnd - sheetProgressStart)
    const progressSpan = (sheetProgressEnd - sheetProgressStart) / totalSheets

    reportProgress({
      phase: 'converting',
      percent: Math.round(progressBase),
      message: `正在解析工作表 ${index + 1} / ${totalSheets}：${sheetName}`,
    })

    let rows: unknown[][]
    try {
      rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, SHEET_TO_JSON_OPTIONS)
    } catch {
      throw new Error(`工作表「${sheetName}」转换失败`)
    }

    sheets[sheetId] = buildWorksheetFromRows(
      rows,
      sheetId,
      sheetName,
      reportProgress,
      progressBase,
      progressSpan * 0.85
    )
    sheetOrder.push(sheetId)
  }

  if (sheetOrder.length === 0) {
    throw new Error('未找到可导入的工作表')
  }

  reportProgress({ phase: 'done', percent: 100, message: '解析完成' })

  return {
    activeSheetId: sheetOrder[0],
    sheetOrder,
    sheets,
  }
}
