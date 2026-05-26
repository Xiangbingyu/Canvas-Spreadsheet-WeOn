import * as XLSX from 'xlsx'
import type { WorkSheet } from 'xlsx'

type ParseExcelResult = WorkSheet | null

/**
 * 将 Excel 文件的二进制内容解析为首个工作表。
 *
 * @param buffer - 由 `file.arrayBuffer()` 得到的 ArrayBuffer
 * @returns 成功返回 WorkSheet；无有效工作表时返回 null
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
  return worksheet
}
