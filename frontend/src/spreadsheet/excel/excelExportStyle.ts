import type { Style } from '@/spreadsheet/model/types'

/** xlsx-js-style 单元格样式对象（OpenXML 子集） */
export type XlsxCellStyle = {
  font?: {
    name?: string
    sz?: number | string
    bold?: boolean
    italic?: boolean
    underline?: boolean
    color?: { rgb: string }
  }
  fill?: {
    patternType?: 'solid' | 'none'
    fgColor?: { rgb: string }
  }
  alignment?: {
    horizontal?: 'left' | 'center' | 'right'
    vertical?: 'center'
  }
}

/** #RRGGBB → xlsx ARGB（无前缀 #，带 FF alpha） */
export function hexToXlsxRgb(hex: string): string {
  const raw = hex.replace(/^#/, '').toUpperCase()
  if (raw.length === 6) return `FF${raw}`
  if (raw.length === 8) return raw
  return `FF${raw.padStart(6, '0').slice(0, 6)}`
}

/** 前端 Style → xlsx-js-style 的 cell.s */
export function styleToXlsxCellStyle(style: Style | undefined): XlsxCellStyle | undefined {
  if (!style) return undefined

  const xlsxStyle: XlsxCellStyle = {}
  const font: NonNullable<XlsxCellStyle['font']> = {}

  if (style.fontFamily) font.name = style.fontFamily
  if (style.fontSize != null) font.sz = style.fontSize
  if (style.bold) font.bold = true
  if (style.italic) font.italic = true
  if (style.underline) font.underline = true
  if (style.color) font.color = { rgb: hexToXlsxRgb(style.color) }

  if (Object.keys(font).length > 0) {
    xlsxStyle.font = font
  }

  if (style.bgColor) {
    xlsxStyle.fill = {
      patternType: 'solid',
      fgColor: { rgb: hexToXlsxRgb(style.bgColor) },
    }
  }

  if (style.hAlign) {
    xlsxStyle.alignment = {
      horizontal: style.hAlign,
      vertical: 'center',
    }
  }

  if (!xlsxStyle.font && !xlsxStyle.fill && !xlsxStyle.alignment) {
    return undefined
  }

  return xlsxStyle
}
