/**
 * Excel 导入 Web Worker（后台线程解析，避免阻塞主线程）
 *
 * - .xlsx / .xlsm：ExcelJS（值 + 样式）
 * - .xls：SheetJS（仅值）
 */

import type { WorkbookData } from '@/spreadsheet/model/types'
import { parseXlsxBufferWithExcelJS } from './excelImportExcelJS'
import { parseSheetJsBuffer } from './excelImportSheetJS'

function isLegacyXlsFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower.endsWith('.xls') && !lower.endsWith('.xlsx') && !lower.endsWith('.xlsm')
}
//解析Excel文件核心逻辑
async function parseExcelBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  reportProgress: (progress: {
    phase: 'reading' | 'converting' | 'building' | 'done'
    percent: number
    message: string
  }) => void
): Promise<WorkbookData> {
  if (!buffer.byteLength) {
    throw new Error('文件为空或无法读取')
  }
  //判断是否是.xls文件
  if (isLegacyXlsFileName(fileName)) {
    return parseSheetJsBuffer(buffer, reportProgress)
  }

  return parseXlsxBufferWithExcelJS(buffer, reportProgress)
}

self.onmessage = async (
  event: MessageEvent<{ type: 'parse'; buffer: ArrayBuffer; fileName: string }>
) => {
  const { data } = event
  if (data.type !== 'parse') return

  try {
    const workbook = await parseExcelBuffer(data.buffer, data.fileName, (progress) => {
      self.postMessage({ type: 'progress', ...progress })
    })
    self.postMessage({ type: 'done', workbook })
  } catch (error) {
    const message = error instanceof Error ? error.message : '工作表转换失败'
    self.postMessage({ type: 'error', message })
  }
}
