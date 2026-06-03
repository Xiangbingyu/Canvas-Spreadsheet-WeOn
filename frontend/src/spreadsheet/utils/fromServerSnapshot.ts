/**
 * 后端 / 协同快照 ↔ 前端 model 转换工具。
 * 每个函数前有「转前接口 + 示例结构 → 转后类型 + 调用方」说明。
 */

import type { Cell, WorkbookData, WorksheetData } from '@/spreadsheet/model/types'
import type { ServerSheetSnapshot, WorkbookSnapshot } from '@/services/httpType'

const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000

/** 前端 workbook 导入片段（无 docTitle），对应 dispatch(importWorkbook) 的 payload */
export type WorkbookImportSnapshot = Pick<WorkbookData, 'activeSheetId' | 'sheetOrder' | 'sheets'>

/** @see fromServerSnapshot */
export type ServerSnapshotInput =
  | (Partial<WorksheetData> & { id?: string; name?: string })
  | {
      activeSheetId?: string
      sheets?: Record<string, Partial<WorksheetData> & { id?: string; name?: string }>
    }

/**
 * fromServerSnapshot
 *
 * 转前（以下两种之一，字段名后端可能用 id/name 或 sheetId/sheetName）：
 *
 * 1) WS `join_ack` / `sheet_imported` 的 data.snapshot（httpType.WorkbookSnapshot，整本）：
 * ```json
 * {
 *   "activeSheetId": "sheet_doc_001_001",
 *   "sheetOrder": ["sheet_doc_001_001"],
 *   "sheets": {
 *     "sheet_doc_001_001": {
 *       "id": "sheet_doc_001_001",
 *       "name": "Sheet1",
 *       "rowCount": 1000,
 *       "colCount": 26,
 *       "styles": { "s1": { "bold": true } },
 *       "cells": { "1:1": { "row": 1, "col": 1, "value": "hi", "styleId": "s1" } }
 *     }
 *   }
 * }
 * ```
 * 本函数取 `sheets[activeSheetId]` 那一项，不再保留整本结构。
 *
 * 2) WS `sheet_added` 的 data.sheet（单张表）：
 * ```json
 * {
 *   "id": "sheet_doc_001_002",
 *   "name": "Sheet2",
 *   "rowCount": 1000,
 *   "colCount": 26,
 *   "styles": {},
 *   "cells": {}
 * }
 * ```
 *
 * 转后：`WorksheetData`（model/types.ts）
 * - 写入 `workSheetStore`：`dispatch(setWorksheet(...))`（join_ack 后激活表）
 * - 或 `applySheetAdded` 里规范化 `data.sheet` 再进 workbook
 *
 * 额外处理：cells 键 `"行:列"`；行列从 1 起；rowCount/colCount 为 0 时补到至少 1000×1000 以便画网格。
 */
export function fromServerSnapshot(snapshot: ServerSnapshotInput): WorksheetData {
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

/**
 * fromHttpDocSheetSnapshot（内部，勿直接对外使用）
 *
 * 转前：GET /docs/:docId 响应里 `snapshot.sheets` 的**某一个**元素（httpType.ServerSheetSnapshot）：
 * ```json
 * {
 *   "id": "sheet_doc_001_001",
 *   "name": "Sheet1",
 *   "defaultRowHeight": 25,
 *   "defaultColWidth": 100,
 *   "rowCount": 1000,
 *   "colCount": 26,
 *   "styles": {},
 *   "cells": { "1:1": { "row": 1, "col": 1, "value": "", "styleId": "..." } }
 * }
 * ```
 *
 * 转后：`WorksheetData`
 * - 仅被 `fromHttpDocWorkbookSnapshot` 循环调用；`fallbackSheetId` 为 Record 的 key（sheets 的键名）。
 */
function fromHttpDocSheetSnapshot(
  snapshot: Partial<WorksheetData> & Partial<ServerSheetSnapshot>,
  fallbackSheetId?: string
): WorksheetData {
  return fromServerSnapshot({
    ...snapshot,
    id: snapshot.id ?? fallbackSheetId,
  })
}

/**
 * fromHttpDocWorkbookSnapshot
 *
 * 转前：HTTP GET /docs/:docId 响应体中的 `data.snapshot`（httpType.WorkbookSnapshot）：
 * ```json
 * {
 *   "activeSheetId": "sheet_doc_001_001",
 *   "sheetOrder": ["sheet_doc_001_001", "sheet_doc_001_002"],
 *   "sheets": {
 *     "sheet_doc_001_001": { "id": "...", "name": "Sheet1", "cells": {}, "styles": {} },
 *     "sheet_doc_001_002": { "id": "...", "name": "Sheet2", "cells": {}, "styles": {} }
 *   }
 * }
 * ```
 * （外层还有 docId、title、currentSeq 等，本函数只收 snapshot 对象。）
 *
 * 转后：`WorkbookImportSnapshot`（即 Pick<WorkbookData, activeSheetId | sheetOrder | sheets>）
 * - `SpreadsheetPage`：`dispatch(initFromDoc({ docTitle, ...workbook }))`
 * - `useCollab` `sheet_imported`：`dispatch(importWorkbook(workbook))` 再 `setWorksheet` 激活表
 *
 * 每张 sheet 经 fromHttpDocSheetSnapshot → WorksheetData；sheetOrder / activeSheetId 与接口对齐或回退到 keys[0]。
 */
export function fromHttpDocWorkbookSnapshot(snapshot: WorkbookSnapshot): WorkbookImportSnapshot {
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

/**
 * worksheetToServerSheet（内部）
 *
 * 转前：前端 `WorksheetData`（sheetId / sheetName / cells / styles …）
 *
 * 转后：httpType.ServerSheetSnapshot（字段 id/name 对应 sheetId/sheetName）：
 * ```json
 * {
 *   "id": "sheet_doc_001_001",
 *   "name": "Sheet1",
 *   "rowCount": 1000,
 *   "colCount": 26,
 *   "styles": {},
 *   "cells": { "1:1": { "row": 1, "col": 1, "value": "hi", "styleId": "s1" } }
 * }
 * ```
 *
 * - 被 `toWorkbookSnapshot`、`toServerWorkbookSnapshotFromPayload` 用来拼 sheets 里的单表。
 */
function worksheetToServerSheet(worksheet: WorksheetData): ServerSheetSnapshot {
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

/**
 * toWorkbookSnapshot
 *
 * 转前：前端当前仅有一张表时的 `WorksheetData`（例如本地只有单 sheet 场景）。
 *
 * 转后：httpType.WorkbookSnapshot（把一张表包进整本结构）：
 * ```json
 * {
 *   "activeSheetId": "<worksheet.sheetId>",
 *   "sheetOrder": ["<worksheet.sheetId>"],
 *   "sheets": {
 *     "<worksheet.sheetId>": { "id": "...", "name": "...", "cells": {}, "styles": {} }
 *   }
 * }
 * ```
 *
 * - 协同 `import_sheet` 等需要 workbook 形态时的兜底；与 POST /docs 的 snapshot 字段同形。
 */
export function toWorkbookSnapshot(worksheet: WorksheetData): WorkbookSnapshot {
  const sheetId = worksheet.sheetId
  return {
    activeSheetId: sheetId,
    sheetOrder: [sheetId],
    sheets: { [sheetId]: worksheetToServerSheet(worksheet) },
  }
}

/**
 * toServerWorkbookSnapshotFromPayload
 *
 * 转前：前端 Redux / Excel 解析后的 `WorkbookImportSnapshot`（已无 docTitle）：
 * ```json
 * {
 *   "activeSheetId": "sheet_doc_001_001",
 *   "sheetOrder": ["sheet_doc_001_001"],
 *   "sheets": {
 *     "sheet_doc_001_001": {
 *       "sheetId": "sheet_doc_001_001",
 *       "sheetName": "Sheet1",
 *       "rowCount": 1000,
 *       "colCount": 26,
 *       "styles": {},
 *       "cells": {}
 *     }
 *   }
 * }
 * ```
 *
 * 转后：httpType.WorkbookSnapshot（POST /docs 请求体、WS `import_sheet` 的 snapshot 字段）：
 * ```json
 * {
 *   "activeSheetId": "sheet_doc_001_001",
 *   "sheetOrder": ["sheet_doc_001_001"],
 *   "sheets": {
 *     "sheet_doc_001_001": {
 *       "id": "sheet_doc_001_001",
 *       "name": "Sheet1",
 *       "cells": {},
 *       "styles": {}
 *     }
 *   }
 * }
 * ```
 *
 * - Menubar 创建文档：`POST /docs` 的 `snapshot`
 * - `useCollab.importWorkbook`：WS `import_sheet` 上行
 */
export function toServerWorkbookSnapshotFromPayload(
  payload: WorkbookImportSnapshot
): WorkbookSnapshot {
  const sheets: Record<string, ServerSheetSnapshot> = {}
  for (const [sheetId, worksheet] of Object.entries(payload.sheets)) {
    sheets[sheetId] = worksheetToServerSheet(worksheet)
  }
  return {
    activeSheetId: payload.activeSheetId,
    sheetOrder: payload.sheetOrder,
    sheets,
  }
}
