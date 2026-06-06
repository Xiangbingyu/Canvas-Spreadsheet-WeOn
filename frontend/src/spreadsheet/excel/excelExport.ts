/**
 * Excel 导出门面：筛选范围 → 生成 .xlsx → 保存
 */
import type { WorksheetData } from '@/spreadsheet/model/types'
import { sanitizeExcelFileName, workbookDataToXlsxBuffer } from './excelExportExcelJS'

export type ExcelExportScope = 'current' | 'all'

export type ExcelExportWorkbookInput = {
  title: string
  scope: ExcelExportScope
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
}

export type ExcelExportResult = 'saved' | 'cancelled'

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

export function canPickExportDirectory(): boolean {
  const w = window as WindowWithDirectoryPicker
  return typeof w.showDirectoryPicker === 'function'
}

async function pickExportDirectory(): Promise<FileSystemDirectoryHandle> {
  const w = window as WindowWithDirectoryPicker
  if (!w.showDirectoryPicker) {
    throw new Error('showDirectoryPicker is not supported')
  }
  return w.showDirectoryPicker()
}

/** scope === 'current' 只导出当前表，'all' 导出全部 */
function pickSheetsForExport(input: ExcelExportWorkbookInput): {
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
} {
  if (input.scope === 'all') {
    return { sheetOrder: input.sheetOrder, sheets: input.sheets }
  }

  const sheet = input.sheets[input.activeSheetId]
  if (!sheet) {
    return { sheetOrder: [], sheets: {} }
  }
  return { sheetOrder: [input.activeSheetId], sheets: { [input.activeSheetId]: sheet } }
}

/** 生成 .xlsx 二进制（筛选范围 → ExcelJS 五步流程） */
export async function buildExcelExportBuffer(
  input: ExcelExportWorkbookInput
): Promise<ArrayBuffer> {
  const { sheetOrder, sheets } = pickSheetsForExport(input)
  return workbookDataToXlsxBuffer(sheetOrder, sheets)
}

/** 写入用户选择的文件夹；不支持 File System Access API 时降级为浏览器下载 */
export async function saveExcelExportToDirectory(
  buffer: ArrayBuffer,
  title: string
): Promise<ExcelExportResult> {
  const fileName = `${sanitizeExcelFileName(title)}.xlsx`

  if (canPickExportDirectory()) {
    const dirHandle = await pickExportDirectory()
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(buffer)
    await writable.close()
    return 'saved'
  }

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
  return 'saved'
}

/** 一键导出 */
export async function exportWorkbookToExcel(
  input: ExcelExportWorkbookInput
): Promise<ExcelExportResult> {
  // 0. 按 scope 筛选 → 1-5. 生成 xlsx（见 excelExportExcelJS.ts）
  const buffer = await buildExcelExportBuffer(input)
  // 6. 选择文件夹保存 / 浏览器下载
  return saveExcelExportToDirectory(buffer, input.title)
}
