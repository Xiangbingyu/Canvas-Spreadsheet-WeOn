import * as XLSX from 'xlsx'

/** 0-based 行列坐标 */
export type RowCol = {
  row: number
  col: number
}

/**
 * Excel 地址 → 0-based 行列（A1 → row:0, col:0）
 */
export function addressToRowCol(address: string): RowCol {
  const { r, c } = XLSX.utils.decode_cell(address.trim().toUpperCase())
  return { row: r, col: c }
}

/**
 * 0-based 行列 → Excel 地址（row:0, col:0 → A1）
 */
export function rowColToAddress(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row, c: col })
}

/**
 * 0-based 行列 → cells Map 的键（row:0, col:0 → "0:0"）
 */
export function toCellKey(row: number, col: number): string {
  return `${row}:${col}`
}

/**
 * cells Map 的键 → 0-based 行列（"0:0" → row:0, col:0）
 */
export function fromCellKey(key: string): RowCol {
  const [rowStr, colStr] = key.split(':')
  const row = Number(rowStr)
  const col = Number(colStr)
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
    throw new Error(`Invalid cell key: ${key}`)
  }
  return { row, col }
}

/**
 * Excel 地址 → cells Map 的键（A1 → "0:0"）
 */
export function addressToCellKey(address: string): string {
  const { row, col } = addressToRowCol(address)
  return toCellKey(row, col)
}

/**
 * cells Map 的键 → Excel 地址（"0:0" → A1）
 */
export function cellKeyToAddress(key: string): string {
  const { row, col } = fromCellKey(key)
  return rowColToAddress(row, col)
}
