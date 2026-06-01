// 公式计算引擎：根据单元格数据计算公式结果

import type { WorksheetData } from '@/spreadsheet/model/types'
import type { ParsedFormula, CellRange } from './formulaParser'

/**
 * 从工作表中获取范围内的所有数值
 */
function getRangeValues(worksheet: WorksheetData, range: CellRange): number[] {
  const values: number[] = []

  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      const key = `${row}:${col}`
      const cell = worksheet.cells[key]
      if (cell && cell.value) {
        const num = parseFloat(cell.value)
        if (!isNaN(num)) {
          values.push(num)
        }
      }
    }
  }

  return values
}

/**
 * 计算 SUM 函数
 */
function calculateSum(values: number[]): number {
  return values.reduce((sum, val) => sum + val, 0)
}

/**
 * 计算 AVERAGE 函数
 */
function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0
  return calculateSum(values) / values.length
}

/**
 * 计算 COUNT 函数（计数非空单元格）
 */
function calculateCount(worksheet: WorksheetData, ranges: CellRange[]): number {
  let count = 0
  for (const range of ranges) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const key = `${row}:${col}`
        const cell = worksheet.cells[key]
        if (cell && cell.value) {
          count++
        }
      }
    }
  }
  return count
}

/**
 * 计算 MAX 函数
 */
function calculateMax(values: number[]): number {
  if (values.length === 0) return 0
  return Math.max(...values)
}

/**
 * 计算 MIN 函数
 */
function calculateMin(values: number[]): number {
  if (values.length === 0) return 0
  return Math.min(...values)
}

/**
 * 计算公式结果
 * 返回计算结果或错误信息
 */
export function calculateFormula(
  worksheet: WorksheetData,
  parsed: ParsedFormula
): { result: number | string; error?: string } {
  if (parsed.type !== 'formula' || !parsed.functionName || !parsed.ranges) {
    return { result: '', error: 'Invalid formula' }
  }

  try {
    const functionName = parsed.functionName.toUpperCase()

    // COUNT 函数特殊处理（不需要转换为数值）
    if (functionName === 'COUNT') {
      const count = calculateCount(worksheet, parsed.ranges)
      return { result: count }
    }

    // 其他函数需要获取数值
    const allValues: number[] = []
    for (const range of parsed.ranges) {
      const values = getRangeValues(worksheet, range)
      allValues.push(...values)
    }

    let result: number
    switch (functionName) {
      case 'SUM':
        result = calculateSum(allValues)
        break
      case 'AVERAGE':
        result = calculateAverage(allValues)
        break
      case 'MAX':
        result = calculateMax(allValues)
        break
      case 'MIN':
        result = calculateMin(allValues)
        break
      default:
        return { result: '', error: `Unknown function: ${functionName}` }
    }

    // 保留两位小数
    return { result: Math.round(result * 100) / 100 }
  } catch (err) {
    return {
      result: '',
      error: `Calculation error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }
}
