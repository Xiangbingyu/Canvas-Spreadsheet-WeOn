/**
 * SheetJS 样式解析：workbook.Styles + sheet.xml 的 s 索引 → model Style
 */

import type * as XLSX from 'xlsx'
import type { Style } from '@/spreadsheet/model/types'
import { isEmptyStyle } from '@/spreadsheet/utils/generateStyleId'
import { a1ToRowCol } from '@/spreadsheet/utils/coordinates'

type XlsxColor = {
  rgb?: string
  theme?: number
  indexed?: number
  tint?: number
}

type XlsxFont = {
  name?: string
  sz?: number
  bold?: boolean | number
  italic?: boolean | number
  underline?: boolean | number
  color?: XlsxColor
}

type XlsxFill = {
  patternType?: string
  fgColor?: XlsxColor
  bgColor?: XlsxColor
}

type XlsxCellXf = {
  fontId?: number
  fontid?: number | string
  fillId?: number
  fillid?: number | string
  alignment?: { horizontal?: string; vertical?: string }
}

type XlsxStyles = {
  Fonts?: XlsxFont[]
  Fills?: XlsxFill[]
  CellXf?: XlsxCellXf[]
}

type XlsxZipEntry = {
  content?: string | Uint8Array | ArrayBuffer
}

export type XlsxWorkbookWithStyles = XLSX.WorkBook & {
  Styles?: XlsxStyles
  Themes?: Record<string, unknown>
  files?: Record<string, XlsxZipEntry>
  Directory?: { sheets?: string[] }
}

/** Office 默认主题色（theme 0 = lt1） */
const DEFAULT_THEME_COLORS = [
  '#FFFFFF',
  '#000000',
  '#EEECE1',
  '#1F497D',
  '#4F81BD',
  '#C0504D',
  '#9BBB59',
  '#8064A2',
  '#4BACC6',
  '#F79646',
  '#0000FF',
  '#800080',
]

const INDEXED_COLORS = [
  '#000000',
  '#FFFFFF',
  '#FF0000',
  '#00FF00',
  '#0000FF',
  '#FFFF00',
  '#FF00FF',
  '#00FFFF',
  '#000000',
  '#FFFFFF',
  '#FF0000',
  '#00FF00',
  '#0000FF',
  '#FFFF00',
  '#FF00FF',
  '#00FFFF',
  '#800000',
  '#008000',
  '#000080',
  '#808000',
  '#800080',
  '#008080',
  '#C0C0C0',
  '#808080',
  '#9999FF',
  '#993366',
  '#FFFFCC',
  '#CCFFFF',
  '#660066',
  '#FF8080',
  '#0066CC',
  '#CCCCFF',
  '#000080',
  '#FF00FF',
  '#FFFF00',
  '#00FFFF',
  '#800080',
  '#800000',
  '#008080',
  '#0000FF',
  '#00CCFF',
  '#CCFFFF',
  '#CCFFCC',
  '#FFFF99',
  '#99CCFF',
  '#FF99CC',
  '#CC99FF',
  '#FFCC99',
  '#3366FF',
  '#33CCCC',
  '#99CC00',
  '#FFCC00',
  '#FF9900',
  '#FF6600',
  '#666699',
  '#969696',
  '#003366',
  '#339966',
  '#003300',
  '#333300',
  '#993300',
  '#993366',
  '#333399',
  '#333333',
]

const CELL_TAG_RE = /<c\b[^>]*>/g

function readZipEntryUtf8(
  files: Record<string, XlsxZipEntry> | undefined,
  path: string
): string | undefined {
  if (!files) return undefined

  const normalized = path.replace(/^\//, '')
  const entry = files[path] ?? files[normalized]
  if (!entry?.content) return undefined

  const { content } = entry
  if (typeof content === 'string') return content
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(content)
  return new TextDecoder().decode(content)
}

function normalizeArgbToHex(rgb: string): string | undefined {
  const hex = rgb.replace(/^#/, '').toUpperCase()
  if (hex.length === 8) return `#${hex.slice(2)}`
  if (hex.length === 6) return `#${hex}`
  return undefined
}

function applyTint(hex: string, tint: number): string {
  if (!tint) return hex

  const raw = hex.replace('#', '')
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)

  const mix = (channel: number) => {
    if (tint < 0) return Math.round(channel * (1 + tint))
    return Math.round(channel + (255 - channel) * tint)
  }

  const toHex = (n: number) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

function xlsxColorToHex(color: XlsxColor | undefined): string | undefined {
  if (!color) return undefined

  if (color.rgb) {
    const hex = normalizeArgbToHex(color.rgb)
    return hex ? applyTint(hex, color.tint ?? 0) : undefined
  }

  if (color.indexed != null && INDEXED_COLORS[color.indexed]) {
    return INDEXED_COLORS[color.indexed]
  }

  if (color.theme != null) {
    const base = DEFAULT_THEME_COLORS[color.theme] ?? DEFAULT_THEME_COLORS[1]
    return applyTint(base, color.tint ?? 0)
  }

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

function isTruthyFlag(value: boolean | number | undefined): boolean {
  return value === true || value === 1
}

function applyFont(font: XlsxFont, style: Style): void {
  if (font.name) style.fontFamily = font.name
  if (font.sz != null && Number.isFinite(font.sz)) style.fontSize = font.sz
  if (isTruthyFlag(font.bold)) style.bold = true
  if (isTruthyFlag(font.italic)) style.italic = true
  if (isTruthyFlag(font.underline)) style.underline = true

  const color = xlsxColorToHex(font.color)
  if (color) style.color = color
}

function applyFill(fill: XlsxFill, style: Style): void {
  if (fill.patternType !== 'solid') return
  const bgColor = xlsxColorToHex(fill.fgColor ?? fill.bgColor)
  if (bgColor) style.bgColor = bgColor
}

function readNumericId(value: number | string | undefined): number | undefined {
  if (value == null) return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** 从 sheet.xml 解析单元格 s 索引，键为 "行:列"（1-based） */
export function parseCellStyleIndexMap(sheetXml: string): Map<string, number> {
  const map = new Map<string, number>()

  for (const match of sheetXml.matchAll(CELL_TAG_RE)) {
    const tag = match[0]
    const refMatch = /\br="([A-Za-z]+\d+)"/.exec(tag)
    const styleMatch = /\bs="(\d+)"/.exec(tag)
    if (!refMatch || !styleMatch) continue

    const pos = a1ToRowCol(refMatch[1])
    if (!pos) continue

    map.set(`${pos.row}:${pos.col}`, Number(styleMatch[1]))
  }

  return map
}

/** 读取首个工作表 sheet.xml，建立 s 索引映射 */
export function buildCellStyleIndexMap(workbook: XlsxWorkbookWithStyles): Map<string, number> {
  const sheetPath = workbook.Directory?.sheets?.[0]
  if (!sheetPath) return new Map()

  const sheetXml = readZipEntryUtf8(workbook.files, sheetPath)
  if (!sheetXml) return new Map()

  return parseCellStyleIndexMap(sheetXml)
}

/** CellXf 索引 → Style */
export function cellXfIndexToStyle(
  workbook: XlsxWorkbookWithStyles,
  xfIndex: number
): Style | undefined {
  const styles = workbook.Styles
  const xf = styles?.CellXf?.[xfIndex]
  if (!styles || !xf) return undefined

  const style: Style = {}

  const fontId = readNumericId(xf.fontId ?? xf.fontid)
  if (fontId != null && styles.Fonts?.[fontId]) {
    applyFont(styles.Fonts[fontId], style)
  }

  const fillId = readNumericId(xf.fillId ?? xf.fillid)
  if (fillId != null && styles.Fills?.[fillId]) {
    applyFill(styles.Fills[fillId], style)
  }

  const hAlign = mapHorizontalAlign(xf.alignment?.horizontal)
  if (hAlign) style.hAlign = hAlign

  return isEmptyStyle(style) ? undefined : style
}

/** 从 SheetJS 合并后的 cell.s 提取有限样式（xls / 无 Styles 时兜底） */
export function styleFromCellObject(cellStyle: unknown): Style | undefined {
  if (!cellStyle || typeof cellStyle !== 'object') return undefined

  const style: Style = {}
  const raw = cellStyle as Record<string, unknown>

  if (typeof raw.name === 'string') style.fontFamily = raw.name
  if (typeof raw.sz === 'number') style.fontSize = raw.sz
  if (isTruthyFlag(raw.bold as boolean | number | undefined)) style.bold = true
  if (isTruthyFlag(raw.italic as boolean | number | undefined)) style.italic = true
  if (isTruthyFlag(raw.underline as boolean | number | undefined)) style.underline = true

  const color = xlsxColorToHex(raw.color as XlsxColor | undefined)
  if (color) style.color = color

  applyFill(raw as XlsxFill, style)

  const alignment = raw.alignment as { horizontal?: string } | undefined
  const hAlign = mapHorizontalAlign(alignment?.horizontal)
  if (hAlign) style.hAlign = hAlign

  return isEmptyStyle(style) ? undefined : style
}

/** 解析单元格样式：优先 xf 索引，其次 cell.s */
export function resolveImportedCellStyle(
  workbook: XlsxWorkbookWithStyles,
  row: number,
  col: number,
  styleIndexMap: Map<string, number>,
  cellStyle: unknown
): Style | undefined {
  const xfIndex = styleIndexMap.get(`${row}:${col}`)
  if (xfIndex != null) {
    const fromXf = cellXfIndexToStyle(workbook, xfIndex)
    if (fromXf) return fromXf
  }

  return styleFromCellObject(cellStyle)
}
