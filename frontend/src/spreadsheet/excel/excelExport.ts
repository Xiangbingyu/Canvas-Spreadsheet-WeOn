/**
 * Excel 导出门面：组装 workbook → 选择文件夹 → 写入 .xlsx
 */
import { buildXlsxWorkbook, sanitizeExcelFileName, xlsxWorkbookToBuffer } from './excelExportCore'
import type { ExcelExportResult, ExcelExportWorkbookInput } from './excelExportTypes'

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

function pickSheetsForExport(input: ExcelExportWorkbookInput): {
  sheetOrder: string[]
  sheets: ExcelExportWorkbookInput['sheets']
} {
  if (input.scope === 'all') {
    return { sheetOrder: input.sheetOrder, sheets: input.sheets }
  }

  const activeId = input.activeSheetId
  const sheet = input.sheets[activeId]
  if (!sheet) {
    return { sheetOrder: [], sheets: {} }
  }
  return { sheetOrder: [activeId], sheets: { [activeId]: sheet } }
}

/** 生成 .xlsx 二进制 */
export function buildExcelExportBuffer(input: ExcelExportWorkbookInput): ArrayBuffer {
  const { sheetOrder, sheets } = pickSheetsForExport(input)
  const wb = buildXlsxWorkbook(sheetOrder, sheets)
  return xlsxWorkbookToBuffer(wb)
}

/** 使用 File System Access API 写入用户选择的文件夹；不支持时降级为浏览器下载 */
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

  // 降级：触发浏览器下载（无法选文件夹）
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

/** 一键导出：组装 buffer + 保存到所选文件夹 */
export async function exportWorkbookToExcel(
  input: ExcelExportWorkbookInput
): Promise<ExcelExportResult> {
  const buffer = buildExcelExportBuffer(input)
  return saveExcelExportToDirectory(buffer, input.title)
}
