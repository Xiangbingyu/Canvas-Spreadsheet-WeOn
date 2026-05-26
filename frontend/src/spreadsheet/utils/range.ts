// Selection range utilities shared by renderer, store, and interaction code.
import type { CellCoord, SelectionRange } from '@/spreadsheet/model/types'

export function normalizeRange(range: SelectionRange): SelectionRange {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      col: Math.min(range.start.col, range.end.col),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      col: Math.max(range.start.col, range.end.col),
    },
  }
}

export function containsCell(range: SelectionRange, coord: CellCoord): boolean {
  const normalized = normalizeRange(range)
  return (
    coord.row >= normalized.start.row &&
    coord.row <= normalized.end.row &&
    coord.col >= normalized.start.col &&
    coord.col <= normalized.end.col
  )
}
