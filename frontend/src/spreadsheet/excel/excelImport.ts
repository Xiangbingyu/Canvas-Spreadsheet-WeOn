import * as XLSX from 'xlsx'
import type { WorksheetData } from '@/spreadsheet/model/types'

const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000
/** 构建 cells 时每处理若干行让出主线程，便于更新进度条 */
const BUILD_CHUNK_ROWS = 200

/**
 * sheet_to_json 选项：所见即所得，与 Excel 单元格「显示内容」一致，再统一转为 string
 * @see https://docs.sheetjs.com/docs/api/utilities/array/#array-output
 */
const SHEET_TO_JSON_OPTIONS: XLSX.Sheet2JSONOpts = {
  /** 输出二维数组：rows[rowIndex][colIndex]；不用首行作字段名，行列与 sheet 一致 */
  header: 1,
  /** 空单元格 / null / undefined 的占位值，避免稀疏数组出现 undefined */
  defval: '',
  /** false = 使用格式化显示文本 cell.w（日期、数字、百分比等与 Excel 上看到的一致） */
  raw: false,
  /** false = 数字也用显示文本（如 "1,234.56"），不保留原始 number */
  rawNumbers: false,
  /** false = 跳过整行空白，大文件可减少无效行 */
  blankrows: false,
  /** false = 不忽略隐藏行列，与 Excel 中可见数据范围一致 */
  skipHidden: false,
}

/**
 * XLSX.read 选项：解析阶段生成 cell.w（显示文本），供 sheet_to_json(raw:false) 使用
 */
const READ_WORKBOOK_OPTIONS: XLSX.ParsingOptions = {
  type: 'array',
  /** false = 不把日期转成 JS Date，按 Excel 显示格式写入 cell.w */
  cellDates: false,
  /** true = 解析时生成 cell.w（单元格在 Excel 里看到什么，导入就是什么） */
  cellText: true,
  /** true = 保留单元格格式码 cell.z，便于正确生成日期/数字的显示文本 */
  cellNF: true,
}

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

export class ExcelParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExcelParseError'
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('导入已取消', 'AbortError')
  }
}

function reportProgress(onProgress: ParseExcelOptions['onProgress'], progress: ParseExcelProgress) {
  onProgress?.(progress)
}

/** 将 sheet_to_json 得到的单元格值统一为字符串（不做日期/数字再格式化） */
function cellValueToString(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * 将 sheet_to_json（header: 1）得到的二维数组写入 WorksheetData.cells（值均为显示文本字符串）
 */
async function buildWorksheetFromRows(
  rows: unknown[][],
  sheetName: string,
  options?: ParseExcelOptions
): Promise<WorksheetData> {
  const { onProgress, signal } = options ?? {}
  const cells: WorksheetData['cells'] = {}
  let maxRow = 0
  let maxCol = 0
  const totalRows = rows.length
  const buildStartPercent = 35
  const buildEndPercent = 98

  for (let r = 0; r < totalRows; r++) {
    assertNotAborted(signal)

    const row = rows[r]
    if (!Array.isArray(row)) continue

    for (let c = 0; c < row.length; c++) {
      const value = cellValueToString(row[c]).trim()
      if (value === '') continue

      const rowNum = r + 1
      const colNum = c + 1
      maxRow = Math.max(maxRow, rowNum)
      maxCol = Math.max(maxCol, colNum)
      cells[`${rowNum}:${colNum}`] = { row: rowNum, col: colNum, value }
    }

    if (totalRows > 0 && (r % BUILD_CHUNK_ROWS === 0 || r === totalRows - 1)) {
      const ratio = (r + 1) / totalRows
      const percent = Math.round(buildStartPercent + ratio * (buildEndPercent - buildStartPercent))
      reportProgress(onProgress, {
        phase: 'building',
        percent,
        message: `正在写入单元格 ${r + 1} / ${totalRows} 行…`,
      })
      if (r > 0 && r % BUILD_CHUNK_ROWS === 0) {
        await yieldToMain()
      }
    }
  }

  const parsedRow = maxRow > 0 ? maxRow : totalRows
  const parsedCol = maxCol

  reportProgress(onProgress, {
    phase: 'done',
    percent: 100,
    message: '解析完成',
  })

  return {
    id: '01',
    name: sheetName || 'Sheet1',
    defaultRowHeight: 25,
    defaultColWidth: 100,
    rowCount: Math.max(DEFAULT_ROW_COUNT, parsedRow),
    colCount: Math.max(DEFAULT_COL_COUNT, parsedCol),
    styles: {},
    cells,
  }
}

/**
 * 将 Excel 二进制内容解析为首个工作表（sheet_to_json + 分阶段进度）。
 *
 * @param buffer - 由 `file.arrayBuffer()` 得到的 ArrayBuffer
 */
export async function parseExcelFromBuffer(
  buffer: ArrayBuffer,
  options?: ParseExcelOptions
): Promise<WorksheetData> {
  const { onProgress, signal } = options ?? {}

  if (!buffer.byteLength) {
    throw new ExcelParseError('文件为空或无法读取')
  }

  assertNotAborted(signal)
  reportProgress(onProgress, {
    phase: 'reading',
    percent: 5,
    message: '正在读取工作簿…',
  })

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, READ_WORKBOOK_OPTIONS)
  } catch (cause) {
    throw new ExcelParseError('无法解析 Excel 文件，请确认文件未损坏', { cause })
  }

  assertNotAborted(signal)
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined
  if (!worksheet) {
    throw new ExcelParseError('未找到可导入的工作表')
  }

  reportProgress(onProgress, {
    phase: 'converting',
    percent: 20,
    message: '正在转换为 JSON…',
  })

  await yieldToMain()
  assertNotAborted(signal)

  let rows: unknown[][]
  try {
    rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, SHEET_TO_JSON_OPTIONS)
  } catch (cause) {
    throw new ExcelParseError('工作表转换失败', { cause })
  }

  reportProgress(onProgress, {
    phase: 'building',
    percent: 35,
    message: '正在构建表格数据…',
  })

  await yieldToMain()

  return buildWorksheetFromRows(rows, firstSheetName ?? 'Sheet1', options)
}
