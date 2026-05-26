// 单元格地址类型，例如 "A1"
export type CellAddress = string

// 单元格坐标
export interface CellCoord {
  row: number
  col: number
}

// 单元格数据
export interface Cell {
  value: string
  styleId?: string
}

// 样式类型
export interface Style {
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  bgColor?: string
  hAlign?: 'left' | 'center' | 'right'
  vAlign?: 'top' | 'middle' | 'bottom'
}

// 选区范围
export interface SelectionRange {
  start: CellCoord
  end: CellCoord
}

// Canvas 渲染配置
export interface RenderConfig {
  rowHeight?: number
  colWidth?: number
  headerHeight?: number
  headerWidth?: number
}

// 默认配置
export const DEFAULT_CONFIG: Required<RenderConfig> = {
  rowHeight: 26,
  colWidth: 100,
  headerHeight: 24,
  headerWidth: 44,
}

// 将列索引转换为字母标签，例如 0 -> "A", 1 -> "B", 26 -> "AA"
export function columnLabel(index: number): string {
  let label = ''
  let n = index
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

// 将字母标签转换为列索引，例如 "A" -> 0, "B" -> 1, "AA" -> 26
export function columnIndex(label: string): number {
  let index = -1
  for (let i = 0; i < label.length; i++) {
    index = index * 26 + (label.charCodeAt(i) - 64)
  }
  return index
}

// 将坐标转换为地址，例如 { row: 0, col: 0 } -> "A1"
export function coordToAddress(coord: CellCoord): CellAddress {
  return `${columnLabel(coord.col)}${coord.row + 1}`
}

// 将地址转换为坐标，例如 "A1" -> { row: 0, col: 0 }
export function addressToCoord(address: CellAddress): CellCoord {
  const match = address.match(/^([A-Za-z]+)(\d+)$/)
  if (!match) {
    throw new Error(`Invalid cell address: ${address}`)
  }
  const col = columnIndex(match[1])
  const row = parseInt(match[2], 1) - 1
  return { row, col }
}
