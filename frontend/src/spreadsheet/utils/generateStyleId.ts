//基于样式内容的 Hash ID
import type { Style } from '@/spreadsheet/model/types'

/** 去掉 undefined 字段，保证相同样式生成相同 ID */
function normalizeStyle(style: Style): Style {
  const normalized: Style = {}
  if (style.fontFamily !== undefined) normalized.fontFamily = style.fontFamily
  if (style.fontSize !== undefined) normalized.fontSize = style.fontSize
  if (style.bold !== undefined) normalized.bold = style.bold
  if (style.italic !== undefined) normalized.italic = style.italic
  if (style.underline !== undefined) normalized.underline = style.underline
  if (style.color !== undefined) normalized.color = style.color
  if (style.bgColor !== undefined) normalized.bgColor = style.bgColor
  if (style.hAlign !== undefined) normalized.hAlign = style.hAlign
  return normalized
}
/** 判断样式是否为空 */
export function isEmptyStyle(style: Style | undefined): boolean {
  if (!style) return true
  return Object.keys(normalizeStyle(style)).length === 0
}

/** 基于样式内容生成稳定 ID */
export function generateStyleId(style: Style): string {
  const normalized = normalizeStyle(style)
  const styleString = JSON.stringify(normalized, Object.keys(normalized).sort())
  return `s_${btoa(encodeURIComponent(styleString))}`
}

/**
 * 在 styles 表中查找或注册样式，相同内容复用同一 styleId
 * @returns 无有效样式时返回 undefined
 */
export function findOrCreateStyleId(
  styles: Record<string, Style>,
  style: Style | undefined
): string | undefined {
  if (isEmptyStyle(style)) {
    return undefined
  }

  const normalized = normalizeStyle(style!)
  const styleId = generateStyleId(normalized)

  if (!styles[styleId]) {
    styles[styleId] = normalized
  }

  return styleId
}
