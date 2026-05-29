/** 选区与坐标相关类型（1-based 行列，与 hitTest / gridRenderer 一致） */

export interface CellCoord {
  row: number
  col: number
}

export interface SelectionRange {
  start: CellCoord
  end: CellCoord
}
