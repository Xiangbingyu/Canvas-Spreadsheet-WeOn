// 表格坐标工具，供渲染、交互和 store 共享使用。
// 输入 1-based 行列或 A1 地址，输出规范化坐标。

/** 行列标头区域尺寸，供渲染和命中检测共享。 */
export const GRID_CHROME = {
  headerRowHeight: 24,
  headerColWidth: 44,
} as const

type RowCol = { row: number; col: number }

/**
 * 作用：将 Excel 列字母转换为 1-based 列号。
 * 传入参数：letters 为列字母，如 A、BC。
 * 返回结果：返回列号；非法输入返回 NaN。
 */
function colLettersToNumber(letters: string): number {
  let col = 0
  for (let i = 0; i < letters.length; i++) {
    const code = letters.charCodeAt(i)
    if (code < 65 || code > 90) return NaN
    col = col * 26 + (code - 64)
  }
  return col
}

/**
 * 作用：将 Excel 单元格地址转为 1-based 行列号。
 * 传入参数：a1 为单元格地址，如 A1、BC23。
 * 返回结果：合法时返回 { row, col }，非法时返回 null。
 */
export function a1ToRowCol(a1: string): RowCol | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(a1.trim())
  if (!m) return null

  const letters = m[1].toUpperCase()
  const row = Number(m[2])
  const col = colLettersToNumber(letters)

  if (!Number.isFinite(row) || row < 1) return null
  if (!Number.isFinite(col) || col < 1) return null

  return { row, col }
}

/**
 * 作用：将 1-based 列号转换为 Excel 列标。
 * 传入参数：col 为列号，如 1、27。
 * 返回结果：返回列标，如 A、AA；非法输入返回空字符串。
 */
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
