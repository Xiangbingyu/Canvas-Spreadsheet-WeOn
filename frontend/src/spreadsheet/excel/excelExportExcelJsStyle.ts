import type ExcelJS from 'exceljs'
import type { Style } from '@/spreadsheet/model/types'
import { isEmptyStyle } from '@/spreadsheet/utils/generateStyleId'

/** #RRGGBB → ExcelJS ARGB */
function hexToArgb(hex: string): string {
  const raw = hex.replace(/^#/, '').toUpperCase()
  if (raw.length === 6) return `FF${raw}`
  if (raw.length === 8) return raw
  return `FF${raw.padStart(6, '0').slice(0, 6)}`
}

/** 前端 Style → ExcelJS 单元格 font/fill/alignment */
export function applyStyleToExcelJsCell(cell: ExcelJS.Cell, style: Style | undefined): void {
  if (!style || isEmptyStyle(style)) return

  const font: Partial<ExcelJS.Font> = {}
  if (style.fontFamily) font.name = style.fontFamily
  if (style.fontSize != null) font.size = style.fontSize
  if (style.bold) font.bold = true
  if (style.italic) font.italic = true
  if (style.underline) font.underline = true
  if (style.color) font.color = { argb: hexToArgb(style.color) }
  if (Object.keys(font).length > 0) cell.font = font

  if (style.bgColor) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: hexToArgb(style.bgColor) },
    }
  }

  if (style.hAlign) {
    cell.alignment = { horizontal: style.hAlign, vertical: 'middle' }
  }
}
