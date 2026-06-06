/**
 * .xlsx / .xlsm：ExcelJS 导入值 + 样式
 */

import ExcelJS from 'exceljs'
import type { WorkbookData, WorksheetData } from '@/spreadsheet/model/types'
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'
import { styleFromExcelJsCell } from './excelImportExcelJsStyle'

const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000
const BUILD_CHUNK_ROWS = 200

type ParseProgressReporter = (progress: {
  phase: 'reading' | 'converting' | 'building' | 'done'
  percent: number
  message: string
}) => void
//获取单元格文本值
function cellTextValue(cell: ExcelJS.Cell): string {
  const text = typeof cell.text === 'string' ? cell.text.trim() : ''
  if (text) return text
  if (cell.value == null) return ''
  if (cell.value instanceof Date) return cell.text || cell.value.toISOString()
  if (typeof cell.value === 'object' && 'richText' in cell.value) {
    const parts = (cell.value as ExcelJS.CellRichTextValue).richText
    return parts
      .map((part) => part.text)
      .join('')
      .trim()
  }
  return String(cell.value).trim()
}
//把工作表转换为WorksheetData
function buildWorksheetFromExcelJS(
  worksheet: ExcelJS.Worksheet,
  sheetId: string,
  sheetName: string,
  reportProgress: ParseProgressReporter,
  progressBase: number,
  progressSpan: number
): WorksheetData {
  const cells: WorksheetData['cells'] = {}
  const styles: WorksheetData['styles'] = {}
  let maxRow = 0
  let maxCol = 0
  //获取工作表行数
  const rowCount = worksheet.rowCount
  let processedRows = 0

  //遍历工作表行
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    //遍历工作表列
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = cellTextValue(cell)
      if (value === '') return

      //更新最大行数和最大列数
      maxRow = Math.max(maxRow, rowNumber)
      maxCol = Math.max(maxCol, colNumber)
      //获取单元格样式
      const styleId = findOrCreateStyleId(styles, styleFromExcelJsCell(cell))
      //创建单元格数据
      const cellData = { row: rowNumber, col: colNumber, value }
      if (styleId) {
        cells[`${rowNumber}:${colNumber}`] = { ...cellData, styleId }
      } else {
        cells[`${rowNumber}:${colNumber}`] = cellData
      }
    })

    processedRows += 1
    if (rowCount > 0 && (processedRows % BUILD_CHUNK_ROWS === 0 || processedRows === rowCount)) {
      const ratio = processedRows / rowCount
      reportProgress({
        phase: 'building',
        percent: Math.round(progressBase + ratio * progressSpan),
        message: `正在写入「${sheetName}」${processedRows} / ${rowCount} 行…`,
      })
    }
  })

  const parsedRow = maxRow > 0 ? maxRow : rowCount
  return {
    sheetId,
    sheetName: sheetName || 'Sheet1',
    defaultRowHeight: 25,
    defaultColWidth: 100,
    rowCount: Math.max(DEFAULT_ROW_COUNT, parsedRow),
    colCount: Math.max(DEFAULT_COL_COUNT, maxCol),
    styles,
    cells,
  }
}

export async function parseXlsxBufferWithExcelJS(
  buffer: ArrayBuffer,
  reportProgress: ParseProgressReporter
): Promise<WorkbookData> {
  reportProgress({
    phase: 'reading',
    percent: 5,
    message: '正在读取工作簿…',
  })

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    throw new Error('无法解析 Excel 文件，请确认文件未损坏')
  }

  const worksheets = workbook.worksheets
  if (worksheets.length === 0) {
    throw new Error('未找到可导入的工作表')
  }

  const sheets: Record<string, WorksheetData> = {}
  const sheetOrder: string[] = []
  const totalSheets = worksheets.length
  const sheetProgressStart = 15
  const sheetProgressEnd = 98

  //解析工作表
  for (let index = 0; index < totalSheets; index++) {
    const worksheet = worksheets[index]
    const sheetName = worksheet.name || `Sheet${index + 1}`
    const sheetId = `import_${String(index + 1).padStart(3, '0')}`
    //计算进度
    const progressBase =
      sheetProgressStart + (index / totalSheets) * (sheetProgressEnd - sheetProgressStart)
    const progressSpan = (sheetProgressEnd - sheetProgressStart) / totalSheets

    reportProgress({
      phase: 'converting',
      percent: Math.round(progressBase),
      message: `正在解析工作表 ${index + 1} / ${totalSheets}：${sheetName}`,
    })

    //把工作表转换为WorksheetData
    sheets[sheetId] = buildWorksheetFromExcelJS(
      worksheet,
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
