/**
 * Excel 导入门面：主线程通过 Web Worker 解析
 * - .xlsx：ExcelJS（值 + 样式）
 * - .xls：SheetJS（仅值）
 */

import type { WorkbookData } from '@/spreadsheet/model/types'

export class ExcelParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExcelParseError'
  }
}

/**
 * 将 Excel 二进制内容解析为多 sheet workbook 快照（在 Web Worker 中执行）。
 *
 * @param buffer - 由 `file.arrayBuffer()` 得到的 ArrayBuffer（会 transfer 到 Worker）
 * @param fileName - 用于区分 .xls（仅值）与 .xlsx（ExcelJS 含样式）
 */
export function parseExcelFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  options?: {
    onProgress?: (progress: {
      phase: 'reading' | 'converting' | 'building' | 'done'
      percent: number
      message: string
    }) => void
    signal?: AbortSignal
  }
): Promise<WorkbookData> {
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

    worker.onmessage = (
      event: MessageEvent<
        | {
            type: 'progress'
            phase: 'reading' | 'converting' | 'building' | 'done'
            percent: number
            message: string
          }
        | { type: 'done'; workbook: WorkbookData }
        | { type: 'error'; message: string }
      >
    ) => {
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

    worker.postMessage({ type: 'parse', buffer, fileName }, [buffer])
  })
}
