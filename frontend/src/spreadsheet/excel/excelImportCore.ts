/**
 * Excel 解析核心逻辑（仅在 Web Worker 中调用，内含 xlsx）
 */

import * as XLSX from 'xlsx'
import type { WorksheetData } from '@/spreadsheet/model/types'
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'
import {
  buildCellStyleIndexMap,
  resolveImportedCellStyle,
  type XlsxWorkbookWithStyles,
} from './excelImportStyle'
import type { ExcelImportWorkbook, ParseExcelProgress } from './excelImportTypes'

const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000
const BUILD_CHUNK_ROWS = 200

const SHEET_TO_JSON_OPTIONS: XLSX.Sheet2JSONOpts = {
  header: 1,
  defval: '',
  raw: false,
  rawNumbers: false,
  blankrows: false,
  skipHidden: false,
}

const READ_WORKBOOK_OPTIONS: XLSX.ParsingOptions = {
  type: 'array',
  cellDates: false,
  cellText: true,
  cellNF: true,
  cellStyles: true,
  bookFiles: true,
}

function cellValueToString(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function buildWorksheetFromRows(
  rows: unknown[][],
  sheetId: string,
  sheetName: string,
  workbook: XlsxWorkbookWithStyles,
  worksheet: XLSX.WorkSheet,
  styleIndexMap: Map<string, number>,
  reportProgress: (progress: ParseExcelProgress) => void,
  progressBase: number,
  progressSpan: number
): WorksheetData {
  const cells: WorksheetData['cells'] = {}
  const styles: WorksheetData['styles'] = {}
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

      const cellAddr = XLSX.utils.encode_cell({ r: r, c: c })
      const xlsxCell = worksheet[cellAddr] as XLSX.CellObject | undefined
      const importedStyle = resolveImportedCellStyle(
        workbook,
        rowNum,
        colNum,
        styleIndexMap,
        xlsxCell?.s
      )
      const styleId = findOrCreateStyleId(styles, importedStyle)

      const cell = { row: rowNum, col: colNum, value }
      if (styleId) {
        cells[`${rowNum}:${colNum}`] = { ...cell, styleId }
      } else {
        cells[`${rowNum}:${colNum}`] = cell
      }
    }

    if (totalRows > 0 && (r % BUILD_CHUNK_ROWS === 0 || r === totalRows - 1)) {
      const ratio = (r + 1) / totalRows
      const percent = Math.round(progressBase + ratio * progressSpan)
      reportProgress({
        phase: 'building',
        percent,
        message: `正在写入「${sheetName}」${r + 1} / ${totalRows} 行…`,
      })
    }
  }

  const parsedRow = maxRow > 0 ? maxRow : totalRows
  const parsedCol = maxCol

  return {
    sheetId,
    sheetName: sheetName || 'Sheet1',
    defaultRowHeight: 25,
    defaultColWidth: 100,
    rowCount: Math.max(DEFAULT_ROW_COUNT, parsedRow),
    colCount: Math.max(DEFAULT_COL_COUNT, parsedCol),
    styles,
    cells,
  }
}

/** 在 Worker 线程中解析 Excel buffer → 多 sheet workbook 快照 */
export function parseExcelBufferCore(
  buffer: ArrayBuffer,
  reportProgress: (progress: ParseExcelProgress) => void
): ExcelImportWorkbook {
  if (!buffer.byteLength) {
    throw new Error('文件为空或无法读取')
  }

  reportProgress({
    phase: 'reading',
    percent: 5,
    message: '正在读取工作簿…',
  })

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, READ_WORKBOOK_OPTIONS)
  } catch {
    throw new Error('无法解析 Excel 文件，请确认文件未损坏')
  }

  const sheetNames = workbook.SheetNames
  if (sheetNames.length === 0) {
    throw new Error('未找到可导入的工作表')
  }

  const styledWorkbook = workbook as XlsxWorkbookWithStyles

  const sheets: Record<string, WorksheetData> = {}
  const sheetOrder: string[] = []
  const totalSheets = sheetNames.length
  const sheetProgressStart = 15
  const sheetProgressEnd = 98

  for (let index = 0; index < totalSheets; index++) {
    const sheetName = sheetNames[index]
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) continue

    const styleIndexMap = buildCellStyleIndexMap(styledWorkbook, index)

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
      styledWorkbook,
      worksheet,
      styleIndexMap,
      reportProgress,
      progressBase,
      progressSpan * 0.85
    )
    sheetOrder.push(sheetId)
  }

  if (sheetOrder.length === 0) {
    throw new Error('未找到可导入的工作表')
  }

  reportProgress({
    phase: 'done',
    percent: 100,
    message: '解析完成',
  })

  return {
    activeSheetId: sheetOrder[0],
    sheetOrder,
    sheets,
  }
}
