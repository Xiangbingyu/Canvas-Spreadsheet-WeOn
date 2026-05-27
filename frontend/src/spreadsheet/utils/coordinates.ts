//解析Excel单元格地址

type RowCol = { row: number; col: number }

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
 * Excel 单元格地址（如 "A1"、"BC23"）转为行列号（从 1 开始）。
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
