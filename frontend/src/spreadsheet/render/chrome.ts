/** 行列标头区域尺寸（与 SpreadsheetGrid 一致） */
export const GRID_CHROME = {
  headerRowHeight: 24,
  headerColWidth: 44,
} as const

/** 列号（从 1 开始）转为 Excel 列标，如 1→A、27→AA */
export function colNumberToLetters(col: number): string {
  if (!Number.isFinite(col) || col < 1) return ''

  let label = ''
  let n = col - 1
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}
