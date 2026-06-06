import type { Style } from '@/spreadsheet/model/types'
import type ExcelJS from 'exceljs'
import { isEmptyStyle } from '@/spreadsheet/utils/generateStyleId'

function argbToHex(argb?: string): string | undefined {
  if (!argb) return undefined
  const hex = argb.replace(/^#/, '').toUpperCase()
  if (hex.length === 8) return `#${hex.slice(2)}`
  if (hex.length === 6) return `#${hex}`
  return undefined
}

function mapHorizontalAlign(value: string | undefined): Style['hAlign'] | undefined {
  switch (value) {
    case 'center':
    case 'centerContinuous':
    case 'distributed':
      return 'center'
    case 'right':
      return 'right'
    case 'left':
      return 'left'
    default:
      return undefined
  }
}

function isTruthyUnderline(value: ExcelJS.Font['underline']): boolean {
  return value === true || value === 'single' || value === 'double'
}

/** ExcelJS 单元格 font/fill/alignment → 前端 Style */
export function styleFromExcelJsCell(cell: ExcelJS.Cell): Style | undefined {
  const style: Style = {}
  const font = cell.font

  if (font?.name) style.fontFamily = font.name
  if (font?.size != null && Number.isFinite(font.size)) style.fontSize = font.size
  if (font?.bold) style.bold = true
  if (font?.italic) style.italic = true
  if (font?.underline != null && isTruthyUnderline(font.underline)) style.underline = true

  const fontColor = argbToHex(
    typeof font?.color === 'object' && font.color && 'argb' in font.color
      ? (font.color.argb as string | undefined)
      : undefined
  )
  if (fontColor) style.color = fontColor

  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
    const bgColor = argbToHex(fill.fgColor?.argb ?? fill.bgColor?.argb)
    if (bgColor) style.bgColor = bgColor
  }

  const hAlign = mapHorizontalAlign(cell.alignment?.horizontal)
  if (hAlign) style.hAlign = hAlign

  return isEmptyStyle(style) ? undefined : style
}
