// TSV/CSV 转换工具：系统剪贴板与内部表格数据的互转

import type { ClipboardCell } from '@/spreadsheet/store/clipboardStore'

/**
 * 将选区单元格转为 TSV 格式（制表符分隔列，换行符分隔行）
 * 用于写入系统剪贴板，与 Excel/Sheets 兼容
 */
export function cellsToTSV(
  cells: Record<string, ClipboardCell>,
  range: { startRow: number; startCol: number; endRow: number; endCol: number }
): string {
  const rows: string[] = []
  for (let row = range.startRow; row <= range.endRow; row++) {
    const cols: string[] = []
    for (let col = range.startCol; col <= range.endCol; col++) {
      const key = `${row}:${col}`
      const cell = cells[key]
      const value = cell?.value ?? ''
      // 转义：如果值包含制表符、换行符或双引号，用双引号包裹并转义内部双引号
      const escaped =
        value.includes('\t') || value.includes('\n') || value.includes('"')
          ? `"${value.replace(/"/g, '""')}"` // CSV 标准转义
          : value
      cols.push(escaped)
    }
    rows.push(cols.join('\t'))
  }
  return rows.join('\n')
}

/**
 * 解析 TSV/CSV 文本为单元格数据
 * 返回 { cells, range } 格式，与内部剪贴板结构一致
 */
export function parseTSV(text: string): {
  cells: Record<string, ClipboardCell>
  range: { startRow: number; startCol: number; endRow: number; endCol: number }
} | null {
  if (!text || typeof text !== 'string') return null

  const lines = text.split('\n').filter((line) => line.length > 0)
  if (lines.length === 0) return null

  const cells: Record<string, ClipboardCell> = {}
  let maxCol = 0

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]
    const cols = parseCSVLine(line)
    maxCol = Math.max(maxCol, cols.length)

    for (let col = 0; col < cols.length; col++) {
      const value = cols[col]
      if (value) {
        // 1-based 索引：粘贴时从 (1, 1) 开始
        const key = `${row + 1}:${col + 1}`
        cells[key] = { value }
      }
    }
  }

  return {
    cells,
    range: {
      startRow: 1,
      startCol: 1,
      endRow: lines.length,
      endCol: maxCol,
    },
  }
}

/**
 * 解析 CSV 行（处理引号转义）
 * 支持 RFC 4180 标准：双引号包裹的字段可包含逗号、换行；内部双引号转义为 ""
 */
function parseCSVLine(line: string): string[] {
  const cols: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // 转义的双引号："" → "
        current += '"'
        i++ // 跳过下一个 "
      } else {
        // 引号开关
        inQuotes = !inQuotes
      }
    } else if (char === '\t' && !inQuotes) {
      // 制表符分隔（不在引号内）
      cols.push(current)
      current = ''
    } else {
      current += char
    }
  }

  cols.push(current)
  return cols
}
