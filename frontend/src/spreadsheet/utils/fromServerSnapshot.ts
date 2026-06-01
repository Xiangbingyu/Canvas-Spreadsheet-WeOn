import type { Cell, WorksheetData } from '@/spreadsheet/model/types'
import type { ServerSheetSnapshot, WorkbookSnapshot } from '@/services/httpType'

/** 与 workSheetStore 初始态一致：后端新建文档 snapshot 常为 rowCount/colCount=0，需补全才能绘制网格 */
const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000

/** 后端 snapshot 字段（id/name）与前端 WorksheetData（sheetId/sheetName）的并集 */
type ServerSnapshotInput =
  | (Partial<WorksheetData> & {
      id?: string
      name?: string
    })
  | {
      activeSheetId?: string
      sheets?: Record<string, Partial<WorksheetData> & { id?: string; name?: string }>
    }

/**
 * 将后端返回的文档快照规范化为前端 WorksheetData。
 *
 * 约定（与接口文档一致）：
 * - snapshot 可能是 workbook 结构（含 activeSheetId 和 sheets）或单个 sheet 结构
 * - 如果是 workbook，提取 activeSheetId 对应的 sheet
 * - snapshot.cells 的 row / col 从 1 开始（A1 → row=1, col=1）
 * - cells 键名为 "行号:列号"，如 "1:1"
 * - snapshot.id / snapshot.name 映射为 sheetId / sheetName
 *
 * 使用场景：join_ack、import_sheet 等（协同模块）写入 workSheetStore 前调用
 */
export function fromServerSnapshot(snapshot: ServerSnapshotInput): WorksheetData {
  // 如果是 workbook 结构（含 activeSheetId 和 sheets），提取当前 sheet
  let sheetData: Partial<WorksheetData> & { id?: string; name?: string } =
    snapshot as Partial<WorksheetData> & { id?: string; name?: string }
  if ('activeSheetId' in snapshot && 'sheets' in snapshot) {
    const wb = snapshot as {
      activeSheetId?: string
      sheets?: Record<string, Partial<WorksheetData> & { id?: string; name?: string }>
    }
    if (wb.activeSheetId && wb.sheets && wb.sheets[wb.activeSheetId]) {
      sheetData = wb.sheets[wb.activeSheetId]
    }
  }

  const cells: WorksheetData['cells'] = {}

  for (const cell of Object.values((sheetData as Record<string, unknown>).cells ?? {})) {
    if (cell && typeof cell === 'object' && 'row' in cell && 'col' in cell) {
      const raw = cell as {
        row: number
        col: number
        value?: string
        styleId?: string | null
      }
      const normalized: Cell = {
        row: raw.row,
        col: raw.col,
        value: typeof raw.value === 'string' ? raw.value : '',
      }
      if (typeof raw.styleId === 'string' && raw.styleId) {
        normalized.styleId = raw.styleId
      }
      cells[`${normalized.row}:${normalized.col}`] = normalized
    }
  }

  let maxRow = ((sheetData as Record<string, unknown>).rowCount as number) ?? 0
  let maxCol = ((sheetData as Record<string, unknown>).colCount as number) ?? 0
  for (const cell of Object.values(cells)) {
    maxRow = Math.max(maxRow, cell.row)
    maxCol = Math.max(maxCol, cell.col)
  }

  const sheetId =
    (typeof sheetData.sheetId === 'string' && sheetData.sheetId) ||
    (typeof sheetData.id === 'string' && sheetData.id) ||
    '01'
  const sheetName =
    (typeof sheetData.sheetName === 'string' && sheetData.sheetName) ||
    (typeof sheetData.name === 'string' && sheetData.name) ||
    'Sheet1'

  return {
    sheetId,
    sheetName,
    defaultRowHeight: sheetData.defaultRowHeight ?? 25,
    defaultColWidth: sheetData.defaultColWidth ?? 100,
    rowCount: Math.max(DEFAULT_ROW_COUNT, maxRow),
    colCount: Math.max(DEFAULT_COL_COUNT, maxCol),
    styles: sheetData.styles ?? {},
    cells,
  }
}

type HttpSheetInput = Partial<WorksheetData> & Partial<ServerSheetSnapshot>

/** 将 GET /docs/:docId 响应中的单个 sheet 规范化为 WorksheetData（cells 行列从 1 开始） */
function fromHttpDocSheetSnapshot(
  snapshot: HttpSheetInput,
  fallbackSheetId?: string
): WorksheetData {
  return fromServerSnapshot({
    ...snapshot,
    id: snapshot.id ?? fallbackSheetId,
  })
}

/** 将 GET /docs/:docId 响应中的 workbook 快照规范化为 workbookStore payload */
export function fromHttpDocWorkbookSnapshot(snapshot: WorkbookSnapshot): {
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
} {
  const sheets: Record<string, WorksheetData> = {}

  for (const [sheetId, sheetSnapshot] of Object.entries(snapshot.sheets ?? {})) {
    sheets[sheetId] = fromHttpDocSheetSnapshot(sheetSnapshot, sheetId)
  }

  const sheetOrder =
    Array.isArray(snapshot.sheetOrder) && snapshot.sheetOrder.length > 0
      ? snapshot.sheetOrder.filter((id) => sheets[id])
      : Object.keys(sheets)

  const activeSheetId =
    typeof snapshot.activeSheetId === 'string' && sheets[snapshot.activeSheetId]
      ? snapshot.activeSheetId
      : (sheetOrder[0] ?? '')

  return { activeSheetId, sheetOrder, sheets }
}

/** 将前端 WorksheetData 转为后端单个 sheet 快照形态（协作 import_sheet 等） */
export function toServerSnapshot(worksheet: WorksheetData): ServerSnapshotInput {
  return {
    id: worksheet.sheetId,
    name: worksheet.sheetName,
    defaultRowHeight: worksheet.defaultRowHeight,
    defaultColWidth: worksheet.defaultColWidth,
    rowCount: worksheet.rowCount,
    colCount: worksheet.colCount,
    styles: worksheet.styles,
    cells: worksheet.cells,
  }
}
