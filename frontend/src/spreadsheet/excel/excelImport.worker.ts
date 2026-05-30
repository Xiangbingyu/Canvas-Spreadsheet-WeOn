/**
 * Excel 导入 Web Worker：在后台线程执行 xlsx 解析，避免阻塞主线程
 */

import { parseExcelBufferCore } from './excelImportCore'
import type { ExcelImportWorkerRequest, ExcelImportWorkerResponse } from './excelImportTypes'

self.onmessage = (event: MessageEvent<ExcelImportWorkerRequest>) => {
  const { data } = event
  if (data.type !== 'parse') return

  try {
    const worksheet = parseExcelBufferCore(data.buffer, (progress) => {
      const msg: ExcelImportWorkerResponse = { type: 'progress', ...progress }
      self.postMessage(msg)
    })
    const done: ExcelImportWorkerResponse = { type: 'done', worksheet }
    self.postMessage(done)
  } catch (error) {
    const message = error instanceof Error ? error.message : '工作表转换失败'
    const err: ExcelImportWorkerResponse = { type: 'error', message }
    self.postMessage(err)
  }
}
