import type { WorksheetData } from '@/spreadsheet/model/types'

export type ParseExcelPhase = 'reading' | 'converting' | 'building' | 'done'

export type ParseExcelProgress = {
  phase: ParseExcelPhase
  percent: number
  message: string
}

export type ParseExcelOptions = {
  onProgress?: (progress: ParseExcelProgress) => void
  signal?: AbortSignal
}

export type ExcelImportWorkerRequest = {
  type: 'parse'
  buffer: ArrayBuffer
}

export type ExcelImportWorkerResponse =
  | ({ type: 'progress' } & ParseExcelProgress)
  | { type: 'done'; worksheet: WorksheetData }
  | { type: 'error'; message: string }

export class ExcelParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExcelParseError'
  }
}
