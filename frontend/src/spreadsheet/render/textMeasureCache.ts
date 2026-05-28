// Cached Canvas text measurement for renderer-only overflow handling.
// Input: canvas context and text; output: measured width or clipped text.

const MAX_CACHE_SIZE = 5000
const ELLIPSIS = '...'

const widthCache = new Map<string, number>()

function getCacheKey(font: string, text: string): string {
  return `${font}::${text}`
}

/**
 * 作用：缓存 Canvas 文本宽度测量结果，减少滚动和重复渲染时的 measureText 调用。
 * 传入参数：ctx 为 Canvas 2D 上下文，text 为待测量文本，font 为可选字体字符串。
 * 返回结果：返回文本在当前字体下的宽度，单位为逻辑像素。
 */
export function measureTextCached(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string = ctx.font
): number {
  const key = getCacheKey(font, text)
  const cached = widthCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const width = ctx.measureText(text).width
  if (widthCache.size >= MAX_CACHE_SIZE) {
    widthCache.clear()
  }
  widthCache.set(key, width)
  return width
}

/**
 * 作用：根据单元格可用宽度返回适合绘制的文本，超长时使用省略号截断。
 * 传入参数：ctx 为 Canvas 2D 上下文，text 为原始文本，maxWidth 为可用宽度。
 * 返回结果：返回原文本或截断后的文本；不修改外部状态。
 */
export function fitTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (maxWidth <= 0 || text.length === 0) {
    return ''
  }

  if (measureTextCached(ctx, text) <= maxWidth) {
    return text
  }

  if (measureTextCached(ctx, ELLIPSIS) > maxWidth) {
    return ''
  }

  let low = 0
  let high = text.length
  let best = ''

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = `${text.slice(0, mid)}${ELLIPSIS}`
    if (measureTextCached(ctx, candidate) <= maxWidth) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}
