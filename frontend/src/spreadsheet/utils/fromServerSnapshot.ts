/**
 * 各接口 snapshot ↔ 前端 model（WorkbookData / WorksheetData）转换。
 *
 * 后端 wire 字段 id/name 与前端 sheetId/sheetName 同义，在本文件内统一规范化。
 * 协议与 HTTP 字段说明见 docs/接口文档.md、spreadsheet/model/collabProtocol.ts、services/httpType.ts。
 *
 * ── 下行：接口响应 → 前端 model ──────────────────────────────────────────
 *
 * 响应一 — `join_ack`（仅返回给当前客户端）的 data.snapshot
 *   → WorkbookData：`wireWorkbookToWorkbook`
 *
 * 响应二 — GET /docs/:docId（及 POST /docs 创建成功）的 data.snapshot
 *   → WorkbookData：`wireWorkbookToWorkbook`
 *
 * 响应三 — `sheet_imported` 的 data.snapshot
 *   → WorkbookData：`wireWorkbookToWorkbook`
 *
 * 响应四 — `sheet_added` 的 data.sheet
 *   → WorksheetData：`wireSheetToWorksheet`
 *
 * ── 上行：前端 model → 请求体 snapshot ─────────────────────────────────────
 *
 * 请求一 — POST /docs 请求体 snapshot
 *   ← WorkbookData：`workbookToWireWorkbook`
 *
 * 请求二 — WS `import_sheet` 的 snapshot
 *   ← WorkbookData：`workbookToWireWorkbook`
 */

import type { Cell, WorkbookData, WorksheetData } from '@/spreadsheet/model/types'

const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000

/** 前端 workbook 导入片段，对应 dispatch(importWorkbook) 的 payload */
export type WorkbookImportSnapshot = WorkbookData

/** 后端 snapshot 单表入参（字段可能是 id/name 或 sheetId/sheetName） */
type WireSheetInput = Partial<WorksheetData> & { id?: string; name?: string }

/**
 * 响应四 — `sheet_added`.data.sheet → WorksheetData
 *
 * 规范化：id/name → sheetId/sheetName；cells 键统一为 "行:列"；
 * rowCount/colCount 为 0 或偏小时补至至少 1000×1000。
 */
export function wireSheetToWorksheet(snapshot: WireSheetInput): WorksheetData {
  const cells: WorksheetData['cells'] = {}

  for (const cell of Object.values((snapshot as Record<string, unknown>).cells ?? {})) {
    if (cell && typeof cell === 'object' && 'row' in cell && 'col' in cell) {
      const raw = cell as { row: number; col: number; value?: string; styleId?: string | null }
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

  let maxRow = ((snapshot as Record<string, unknown>).rowCount as number) ?? 0
  let maxCol = ((snapshot as Record<string, unknown>).colCount as number) ?? 0
  for (const cell of Object.values(cells)) {
    maxRow = Math.max(maxRow, cell.row)
    maxCol = Math.max(maxCol, cell.col)
  }

  const sheetId =
    (typeof snapshot.sheetId === 'string' && snapshot.sheetId) ||
    (typeof snapshot.id === 'string' && snapshot.id) ||
    '01'
  const sheetName =
    (typeof snapshot.sheetName === 'string' && snapshot.sheetName) ||
    (typeof snapshot.name === 'string' && snapshot.name) ||
    'Sheet1'

  return {
    sheetId,
    sheetName,
    defaultRowHeight: snapshot.defaultRowHeight ?? 25,
    defaultColWidth: snapshot.defaultColWidth ?? 100,
    rowCount: Math.max(DEFAULT_ROW_COUNT, maxRow),
    colCount: Math.max(DEFAULT_COL_COUNT, maxCol),
    styles: snapshot.styles ?? {},
    cells,
  }
}

/**
 * 响应一 / 二 / 三 — snapshot → WorkbookData
 *
 * - 响应一：`join_ack`.data.snapshot
 * - 响应二：GET /docs/:docId（POST /docs）.data.snapshot
 * - 响应三：`sheet_imported`.data.snapshot
 */
export function wireWorkbookToWorkbook(snapshot: WorkbookData): WorkbookData {
  const sheets: Record<string, WorksheetData> = {}

  for (const [sheetId, sheetSnapshot] of Object.entries(snapshot.sheets ?? {})) {
    sheets[sheetId] = wireSheetToWorksheet({
      ...(sheetSnapshot as WireSheetInput),
      id: (sheetSnapshot as WireSheetInput).id ?? sheetId,
    })
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

/**
 * 请求一 / 二 — WorkbookData → 请求体 snapshot（sheets 内 sheetId/sheetName 序列化为 id/name）
 *
 * - 请求一：POST /docs 请求体 snapshot
 * - 请求二：WS `import_sheet`.snapshot
 */
export function workbookToWireWorkbook(payload: WorkbookData): WorkbookData {
  const sheets: Record<string, WorksheetData> = {}
  for (const [sheetId, worksheet] of Object.entries(payload.sheets)) {
    sheets[sheetId] = {
      id: worksheet.sheetId,
      name: worksheet.sheetName,
      defaultRowHeight: worksheet.defaultRowHeight,
      defaultColWidth: worksheet.defaultColWidth,
      rowCount: worksheet.rowCount,
      colCount: worksheet.colCount,
      styles: worksheet.styles,
      cells: worksheet.cells,
    } as unknown as WorksheetData
  }
  return {
    activeSheetId: payload.activeSheetId,
    sheetOrder: payload.sheetOrder,
    sheets,
  }
}
