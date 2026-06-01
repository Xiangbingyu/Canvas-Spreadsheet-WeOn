// 公式解析工具：将公式字符串解析为结构化数据

/**
 * 单元格范围表示：A1 或 A1:B10
 */
export interface CellRange {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

/**
 * 解析后的公式结构
 */
export interface ParsedFormula {
  type: 'formula' | 'value'
  functionName?: string
  ranges?: CellRange[]
  rawFormula?: string
}

/**
 * 将列字母转为列号（1-based）
 * A → 1, B → 2, Z → 26, AA → 27
 */
export function colLetterToNumber(letter: string): number {
  let result = 0
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1)
  }
  return result
}

/**
 * 将列号转为列字母（1-based）
 * 1 → A, 2 → B, 26 → Z, 27 → AA
 */
export function colNumberToLetter(col: number): string {
  let result = ''
  while (col > 0) {
    col--
    result = String.fromCharCode('A'.charCodeAt(0) + (col % 26)) + result
    col = Math.floor(col / 26)
  }
  return result
}

/**
 * 解析单个单元格引用（如 A1）为坐标
 */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/)
  if (!match) return null
  const col = colLetterToNumber(match[1])
  const row = parseInt(match[2], 10)
  return { row, col }
}

/**
 * 解析单元格范围（如 A1:B10）
 */
export function parseCellRange(rangeStr: string): CellRange | null {
  const parts = rangeStr.split(':')
  if (parts.length === 1) {
    // 单个单元格
    const cell = parseCellRef(parts[0].trim())
    if (!cell) return null
    return { startRow: cell.row, startCol: cell.col, endRow: cell.row, endCol: cell.col }
  } else if (parts.length === 2) {
    // 范围
    const start = parseCellRef(parts[0].trim())
    const end = parseCellRef(parts[1].trim())
    if (!start || !end) return null
    return {
      startRow: Math.min(start.row, end.row),
      startCol: Math.min(start.col, end.col),
      endRow: Math.max(start.row, end.row),
      endCol: Math.max(start.col, end.col),
    }
  }
  return null
}

/**
 * 解析公式字符串
 * 支持格式：=SUM(A1:A10), =AVERAGE(B1:B5), 等
 */
export function parseFormula(input: string): ParsedFormula {
  const trimmed = input.trim()

  // 不是公式
  if (!trimmed.startsWith('=')) {
    return { type: 'value' }
  }

  const formulaStr = trimmed.slice(1).trim()
  const match = formulaStr.match(/^([A-Z]+)\s*\(\s*(.+?)\s*\)$/i)

  if (!match) {
    return { type: 'value', rawFormula: trimmed }
  }

  const functionName = match[1].toUpperCase()
  const argsStr = match[2]

  // 支持的函数列表
  const supportedFunctions = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN']
  if (!supportedFunctions.includes(functionName)) {
    return { type: 'value', rawFormula: trimmed }
  }

  // 解析参数（可能是多个范围，用逗号分隔）
  const ranges: CellRange[] = []
  const argParts = argsStr.split(',')

  for (const part of argParts) {
    const range = parseCellRange(part.trim())
    if (range) {
      ranges.push(range)
    }
  }

  if (ranges.length === 0) {
    return { type: 'value', rawFormula: trimmed }
  }

  return {
    type: 'formula',
    functionName,
    ranges,
    rawFormula: trimmed,
  }
}

/**
 * 检查字符串是否是公式
 */
export function isFormula(input: string): boolean {
  const parsed = parseFormula(input)
  return parsed.type === 'formula'
}
