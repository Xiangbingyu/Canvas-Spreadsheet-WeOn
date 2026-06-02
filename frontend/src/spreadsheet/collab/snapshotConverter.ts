/** cell key → row/col 数字 */
export function parseCellKey(key: string): { row: number; col: number } {
  const [r, c] = key.split(':').map(Number)
  return { row: r, col: c }
}

/** row/col → cell key */
export function toCellKey(row: number, col: number): string {
  return `${row}:${col}`
}
