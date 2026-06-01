/**
 * Excel 导入门面：主线程通过 Web Worker 调用 excelImportCore
 */

import {
  ExcelParseError,
  type ExcelImportWorkbook,
  type ExcelImportWorkerRequest,
  type ExcelImportWorkerResponse,
  type ParseExcelOptions,
} from './excelImportTypes'

export {
  ExcelParseError,
  type ExcelImportWorkbook,
  type ParseExcelOptions,
  type ParseExcelProgress,
  type ParseExcelPhase,
} from './excelImportTypes'

/**
 * 将 Excel 二进制内容解析为多 sheet workbook 快照（在 Web Worker 中执行）。
 *
 * @param buffer - 由 `file.arrayBuffer()` 得到的 ArrayBuffer（会 transfer 到 Worker）
 */
export function parseExcelFromBuffer(
  buffer: ArrayBuffer,
  options?: ParseExcelOptions
): Promise<ExcelImportWorkbook> {
  const { onProgress, signal } = options ?? {}

  if (!buffer.byteLength) {
    return Promise.reject(new ExcelParseError('文件为空或无法读取'))
  }

  if (signal?.aborted) {
    return Promise.reject(new DOMException('导入已取消', 'AbortError'))
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excelImport.worker.ts', import.meta.url), {
      type: 'module',
    })

    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      fn()
    }

    const onAbort = () => {
      finish(() => {
        reject(new DOMException('导入已取消', 'AbortError'))
      })
    }

    signal?.addEventListener('abort', onAbort)

    worker.onmessage = (event: MessageEvent<ExcelImportWorkerResponse>) => {
      const msg = event.data
      if (msg.type === 'progress') {
        onProgress?.({
          phase: msg.phase,
          percent: msg.percent,
          message: msg.message,
        })
        return
      }
      if (msg.type === 'done') {
        finish(() => resolve(msg.workbook))
        return
      }
      if (msg.type === 'error') {
        finish(() => reject(new ExcelParseError(msg.message)))
      }
    }

    worker.onerror = (event) => {
      finish(() => {
        reject(new ExcelParseError(event.message || 'Worker 解析异常'))
      })
    }

    const request: ExcelImportWorkerRequest = { type: 'parse', buffer }
    worker.postMessage(request, [buffer])
  })
}
