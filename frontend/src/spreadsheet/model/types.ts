// Core spreadsheet data types shared by renderer, store, and interaction modules.
export type CellAddress = string
export type CellKey = `${number}:${number}`

export interface CellCoord {
  row: number
  col: number
}

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

export interface Cell {
  row: number
  col: number
  value: string
  styleId?: string
  style?: Style
}

export interface SelectionRange {
  start: CellCoord
  end: CellCoord
}

export interface RenderConfig {
  rowHeight?: number
  colWidth?: number
  headerHeight?: number
  headerWidth?: number
}

export interface ViewportState {
  scrollX: number
  scrollY: number
  width: number
  height: number
}

export interface WorksheetSnapshot {
  rowCount: number
  colCount: number
  cells: Record<string, Cell>
  styles?: Record<string, Style>
}

export interface Worksheet {
  id: string
  name: string
  rowCount?: number
  colCount?: number
  defaultRowHeight: number
  defaultColWidth: number
  styles: Map<string, Style>
  cells: Map<string, Cell>
}

export type WorksheetInput = Worksheet | WorksheetSnapshot

export const DEFAULT_CONFIG: Required<RenderConfig> = {
  rowHeight: 26,
  colWidth: 100,
  headerHeight: 24,
  headerWidth: 44,
}

export function cellKey(coord: CellCoord): CellKey {
  return `${coord.row}:${coord.col}`
}

export function columnLabel(index: number): string {
  let label = ''
  let n = index
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

export function columnIndex(label: string): number {
  let index = -1
  for (let i = 0; i < label.length; i += 1) {
    index = index * 26 + (label.charCodeAt(i) - 64)
  }
  return index
}

export function coordToAddress(coord: CellCoord): CellAddress {
  return `${columnLabel(coord.col)}${coord.row + 1}`
}

export function addressToCoord(address: CellAddress): CellCoord {
  const match = address.match(/^([A-Za-z]+)(\d+)$/)
  if (!match) {
    throw new Error(`Invalid cell address: ${address}`)
  }

  return {
    col: columnIndex(match[1].toUpperCase()),
    row: Number.parseInt(match[2], 10) - 1,
  }
}
