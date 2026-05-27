import type { Snapshot, Cell, CellUpdated } from './protocol'
import type { Style } from '@/spreadsheet/model/types'
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'

/**
 * 将 cell_updated 的 data 转为 Cell 格式，供 Redux updateCell 使用。
 *
 * ⚠️ 索引转换待确认：
 * cell_updated.row/col 是 1-indexed（后端 set_cell 定义）。
 * Cell.row/col 取决于团队约定 — 当前 dev 上 workSheetStore 使用 1-indexed key。
 * 如果确认一致则不需要 row-1 转换。
 */
export function convertCellUpdatedToCell(data: CellUpdated['data'], snapshot: Snapshot): Cell {
  const styleId = findOrCreateStyleId(snapshot.styles, data.style as Style | undefined)

  return {
    row: data.row,
    col: data.col,
    value: data.value,
    styleId,
  }
}

/** snapshot cells Record → Map（方便渲染查询） */
export function convertSnapshotToCells(snapshot: Snapshot): Map<string, Cell> {
  const map = new Map<string, Cell>()
  for (const key of Object.keys(snapshot.cells)) {
    map.set(key, snapshot.cells[key])
  }
  return map
}

/** cell key → row/col 数字 */
export function parseCellKey(key: string): { row: number; col: number } {
  const [r, c] = key.split(':').map(Number)
  return { row: r, col: c }
}

/** row/col → cell key */
export function toCellKey(row: number, col: number): string {
  return `${row}:${col}`
}
