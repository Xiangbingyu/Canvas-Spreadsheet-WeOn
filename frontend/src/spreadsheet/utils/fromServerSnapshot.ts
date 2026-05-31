import type { WorksheetData } from '@/spreadsheet/model/types'

/** 与 workSheetStore 初始态一致：后端新建文档 snapshot 常为 rowCount/colCount=0，需补全才能绘制网格 */
const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000

/** 后端 snapshot 字段（id/name）与前端 WorksheetData（sheetId/sheetName）的并集 */
type ServerSnapshotInput = Partial<WorksheetData> & {
  id?: string
  name?: string
}

/**
 * 将后端返回的文档快照规范化为前端 WorksheetData。
 *
 * 约定（与接口文档一致）：
 * - snapshot.cells 的 row / col 从 1 开始（A1 → row=1, col=1）
 * - cells 键名为 "行号:列号"，如 "1:1"
 * - snapshot.id / snapshot.name 映射为 sheetId / sheetName
 *
 * 使用场景：GET /docs/:docId、join_ack、import_sheet 等写入 workSheetStore 前调用
 */
export function fromServerSnapshot(snapshot: ServerSnapshotInput): WorksheetData {
  const cells: WorksheetData['cells'] = {}

  for (const cell of Object.values(snapshot.cells ?? {})) {
    cells[`${cell.row}:${cell.col}`] = { ...cell }
  }

  let maxRow = snapshot.rowCount ?? 0
  let maxCol = snapshot.colCount ?? 0
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

/** 将前端 WorksheetData 转为后端 snapshot 形态（协作 import_sheet 等） */
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
