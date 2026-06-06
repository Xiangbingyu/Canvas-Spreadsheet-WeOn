/**
 * .xlsx 导出：WorkbookData → ExcelJS（值 + 样式）
 */
import ExcelJS from 'exceljs'
import type { WorksheetData } from '@/spreadsheet/model/types'
import { applyStyleToExcelJsCell } from './excelExportExcelJsStyle'

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

/** WorkbookData（多张 sheet）→ .xlsx ArrayBuffer */
export async function workbookDataToXlsxBuffer(
  sheetOrder: string[],
  sheets: Record<string, WorksheetData>
): Promise<ArrayBuffer> {
  // 1. 创建工作簿
  const workbook = new ExcelJS.Workbook()
  const usedSheetNames = new Set<string>()

  for (let index = 0; index < sheetOrder.length; index++) {
    const sheetId = sheetOrder[index]
    const sheetData = sheets[sheetId]
    if (!sheetData) continue

    // 工作表名去重（Excel 不允许重名）
    let sheetName = sanitizeExcelSheetName(sheetData.sheetName, `Sheet${index + 1}`)
    let suffix = 1
    while (usedSheetNames.has(sheetName)) {
      sheetName = sanitizeExcelSheetName(
        `${sheetData.sheetName}_${suffix}`.slice(0, MAX_SHEET_NAME_LEN),
        `Sheet${index + 1}`
      )
      suffix += 1
    }
    usedSheetNames.add(sheetName)

    // 2. 创建工作表
    const worksheet = workbook.addWorksheet(sheetName)

    // 3. 遍历单元格，写入值 + 样式
    let maxCol = 0
    for (const cell of Object.values(sheetData.cells)) {
      const excelCell = worksheet.getCell(cell.row, cell.col)
      excelCell.value = cell.value
      if (cell.styleId) {
        applyStyleToExcelJsCell(excelCell, sheetData.styles[cell.styleId])
      }
      maxCol = Math.max(maxCol, cell.col)
    }

    // 4. 设置列宽
    if (maxCol > 0 && sheetData.defaultColWidth) {
      const colWidth = Math.max(8, Math.round(sheetData.defaultColWidth / 7))
      for (let col = 1; col <= maxCol; col++) {
        worksheet.getColumn(col).width = colWidth
      }
    }
  }

  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet('Sheet1')
  }

  // 5. 生成 xlsx 二进制
  const out = await workbook.xlsx.writeBuffer()
  const bytes =
    out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike)
  return Uint8Array.from(bytes).buffer
}
