import type { WorksheetData } from '@/spreadsheet/model/types'

/** 与 workSheetStore 初始态一致：后端新建文档 snapshot 常为 rowCount/colCount=0，需补全才能绘制网格 */
const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000

/**
 * 将后端返回的文档快照规范化为前端 WorksheetData。
 *
 * 约定（与接口文档一致）：
 * - snapshot.cells 的 row / col 从 1 开始（A1 → row=1, col=1）
 * - cells 键名为 "行号:列号"，如 "1:1"
 *
 * 行为：
 * - 后端与前端坐标系一致，不做 +1 偏移
 * - 按每个单元格的 row/col 重建 cells 键，避免键与字段值不一致
 *
 * 使用场景：GET /docs/:docId、join_ack、import_sheet 等写入 workSheetStore 前调用
 */
export function fromServerSnapshot(snapshot: WorksheetData): WorksheetData {
  const cells: WorksheetData['cells'] = {}

  for (const cell of Object.values(snapshot.cells)) {
    cells[`${cell.row}:${cell.col}`] = { ...cell }
  }

  let maxRow = snapshot.rowCount
  let maxCol = snapshot.colCount
  for (const cell of Object.values(cells)) {
    maxRow = Math.max(maxRow, cell.row)
    maxCol = Math.max(maxCol, cell.col)
  }

  return {
    ...snapshot,
    cells,
    rowCount: Math.max(DEFAULT_ROW_COUNT, maxRow),
    colCount: Math.max(DEFAULT_COL_COUNT, maxCol),
  }
}
