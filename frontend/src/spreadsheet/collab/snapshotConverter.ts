import type { Snapshot, Cell } from './protocol'

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
