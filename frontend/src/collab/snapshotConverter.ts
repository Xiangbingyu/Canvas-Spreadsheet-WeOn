import type { Snapshot, Cell, CellStyle, CellUpdated } from './protocol'
import { defaultGenerateStyleId } from './CollabClient'

/**
 * 将 cell_updated 的 data (1-indexed, inline style)
 * 转为 Cell 格式 (0-indexed, styleId 引用)
 *
 * 同时负责将 inline style 写入 snapshot.styles 表
 */
export function convertCellUpdatedToCell(
  data: CellUpdated['data'],
  snapshot: Snapshot,
  generateStyleId?: (style: CellStyle) => string
): Cell {
  const styleId = convertStyle(data.style, snapshot, generateStyleId)

  return {
    row: data.row - 1,
    col: data.col - 1,
    value: data.value,
    styleId,
  }
}

/**
 * 将 inline style 对象转为 styleId，写入 styles 表
 */
function convertStyle(
  style: Record<string, unknown> | null,
  snapshot: Snapshot,
  generateStyleId?: (style: CellStyle) => string
): string | null {
  if (!style) return null

  const generate = generateStyleId ?? defaultGenerateStyleId
  const styleId = generate(style as CellStyle)

  // 如果 styles 表里还没有这个 id 才写入（已存在说明是复用）
  if (!(styleId in snapshot.styles)) {
    snapshot.styles[styleId] = style as CellStyle
  }

  return styleId
}

/**
 * 将 snapshot 中的 cells 从 Record 格式转为 Map 格式（方便前端渲染查询）
 * key 保持 "row:col" 不变，value 的 row/col 已经是 0-indexed
 */
export function convertSnapshotToCells(snapshot: Snapshot): Map<string, Cell> {
  const map = new Map<string, Cell>()
  for (const key of Object.keys(snapshot.cells)) {
    map.set(key, snapshot.cells[key])
  }
  return map
}

/**
 * 用 cell key 反算出 row/col 数字
 */
export function parseCellKey(key: string): { row: number; col: number } {
  const [r, c] = key.split(':').map(Number)
  return { row: r, col: c }
}

/**
 * 用 row/col 生成 cell key (0-indexed)
 */
export function toCellKey(row: number, col: number): string {
  return `${row}:${col}`
}
