// 分层 Canvas 渲染器，负责 grid/content/overlay 三层绘制。
// 输入工作表、视口和选区快照，输出绘制到各层画布的像素。

import type { WorksheetData } from '@/spreadsheet/model/types'
import type { SelectionRange } from '@/spreadsheet/model/selection'
import { colNumberToLetters, GRID_CHROME } from './chrome'
import { fitTextToWidth } from './textMeasureCache'
import {
  getCellRect,
  getColHeaderRect,
  getDataViewportSize,
  getRowHeaderRect,
  getVisibleRange,
  type Viewport,
  type VisibleRange,
} from './viewport'

export type GridSelection = SelectionRange | null

export type RenderRect = {
  x: number
  y: number
  width: number
  height: number
}

export type RenderGridOptions = {
  worksheet: WorksheetData
  viewport: Viewport
  selection: GridSelection
}

export type RenderContentOptions = {
  clipRects?: RenderRect[]
}

export type ScrollBlitResult = {
  clipRects: RenderRect[]
}

type DrawContext = {
  ctx: CanvasRenderingContext2D
  worksheet: WorksheetData
  viewport: Viewport
  range: VisibleRange
  rowHeight: number
  colWidth: number
  scrollX: number
  scrollY: number
  selection: GridSelection
}

const COLORS = {
  canvasBg: '#f8f9fa',
  headerBg: '#f8f9fa',
  cellBg: '#ffffff',
  gridLine: '#dadce0',
  headerGridLine: '#dadce0',
  headerText: '#70757a',
  selectionBorder: '#1a73e8',
  selectionFill: 'rgba(26, 115, 232, 0.1)',
  fillHandle: '#1a73e8',
  text: '#202124',
} as const

const TEXT_PADDING = 4
const HEADER_FONT = '500 11px Roboto, Arial, sans-serif'
const ROW_HEADER_FONT = '11px Roboto, Arial, sans-serif'
const MAX_BLIT_RATIO = 0.5

/**
 * 作用：判断可见区域是否包含实际行列。
 * 传入参数：range 为 viewport.ts 计算出的 1-based 可见范围。
 * 返回结果：有可绘制行列返回 true，否则返回 false。
 */
function isRangeVisible(range: VisibleRange): boolean {
  return range.rowEnd >= range.rowStart && range.colEnd >= range.colStart
}

/**
 * 作用：为本次绘制构造只读绘制上下文，统一行高、列宽、滚动和可见范围。
 * 传入参数：ctx 为 Canvas 2D 上下文，options 为 worksheet/viewport/selection 快照。
 * 返回结果：返回 DrawContext；不读取 Redux，不修改外部状态。
 */
function createDrawContext(
  ctx: CanvasRenderingContext2D,
  options: RenderGridOptions,
  rangeOverride?: VisibleRange
): DrawContext {
  const { worksheet, viewport, selection } = options
  const rowHeight = worksheet.defaultRowHeight
  const colWidth = worksheet.defaultColWidth
  const range =
    rangeOverride ??
    getVisibleRange(viewport, rowHeight, colWidth, worksheet.rowCount, worksheet.colCount)

  return {
    ctx,
    worksheet,
    viewport,
    range,
    rowHeight,
    colWidth,
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    selection,
  }
}

/**
 * 作用：清空当前 Canvas 逻辑视口。
 * 传入参数：ctx 为 Canvas 2D 上下文，viewport 提供逻辑宽高。
 * 返回结果：无返回值，只清除当前画布像素。
 */
function clearCanvas(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  ctx.clearRect(0, 0, viewport.viewportWidth, viewport.viewportHeight)
}

/**
 * 作用：清空指定逻辑矩形，供滚动条带补画时局部擦除。
 * 传入参数：ctx 为 Canvas 2D 上下文，rect 为画布逻辑坐标矩形。
 * 返回结果：无返回值，只清除指定区域像素。
 */
function clearRect(ctx: CanvasRenderingContext2D, rect: RenderRect): void {
  ctx.clearRect(rect.x, rect.y, rect.width, rect.height)
}

/**
 * 作用：使用底色铺满底层 grid 画布。
 * 传入参数：ctx 为 Canvas 2D 上下文，viewport 提供逻辑宽高。
 * 返回结果：无返回值，只绘制背景。
 */
function fillCanvasBackground(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  ctx.fillStyle = COLORS.canvasBg
  ctx.fillRect(0, 0, viewport.viewportWidth, viewport.viewportHeight)
}

/**
 * 作用：将后续绘制限制在数据区，避免内容进入行列标头。
 * 传入参数：ctx 为 Canvas 2D 上下文，viewport 提供视口尺寸。
 * 返回结果：无返回值，通过 ctx.clip 修改当前 save 范围内的裁剪区。
 */
function clipDataArea(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  const dataViewport = getDataViewportSize(viewport)
  ctx.beginPath()
  ctx.rect(headerColWidth, headerRowHeight, dataViewport.width, dataViewport.height)
  ctx.clip()
}

/**
 * 作用：将后续绘制限制在指定逻辑矩形内，供 content 层条带补画使用。
 * 传入参数：ctx 为 Canvas 2D 上下文，rect 为需要补画的画布区域。
 * 返回结果：无返回值，通过 ctx.clip 修改当前 save 范围内的裁剪区。
 */
function clipRect(ctx: CanvasRenderingContext2D, rect: RenderRect): void {
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
}

/**
 * 作用：计算两个逻辑矩形的交集。
 * 传入参数：a/b 为画布逻辑坐标矩形。
 * 返回结果：有交集时返回交集矩形，否则返回 null。
 */
function intersectRect(a: RenderRect, b: RenderRect): RenderRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const width = right - x
  const height = bottom - y

  if (width <= 0 || height <= 0) {
    return null
  }

  return { x, y, width, height }
}

/**
 * 作用：获取当前数据区在画布中的逻辑矩形。
 * 传入参数：viewport 为当前视口。
 * 返回结果：返回扣除行列标头后的数据区矩形。
 */
function getDataAreaRect(viewport: Viewport): RenderRect {
  const dataViewport = getDataViewportSize(viewport)
  return {
    x: GRID_CHROME.headerColWidth,
    y: GRID_CHROME.headerRowHeight,
    width: dataViewport.width,
    height: dataViewport.height,
  }
}

/**
 * 作用：根据滚动位移计算 content 层新露出的补画条带。
 * 传入参数：dataRect 为数据区矩形，deltaX/deltaY 为相对上一帧的滚动差值。
 * 返回结果：返回需要局部补画的画布逻辑矩形数组。
 */
function getScrollExposeRects(dataRect: RenderRect, deltaX: number, deltaY: number): RenderRect[] {
  const rects: RenderRect[] = []
  const absX = Math.abs(deltaX)
  const absY = Math.abs(deltaY)

  if (absX > 0) {
    rects.push({
      x: deltaX > 0 ? dataRect.x + dataRect.width - absX : dataRect.x,
      y: dataRect.y,
      width: absX,
      height: dataRect.height,
    })
  }

  if (absY > 0) {
    rects.push({
      x: dataRect.x,
      y: deltaY > 0 ? dataRect.y + dataRect.height - absY : dataRect.y,
      width: dataRect.width,
      height: absY,
    })
  }

  return rects
}

/**
 * 作用：复用 content canvas 已绘制像素，减少连续滚动时的整层重绘成本。
 * 传入参数：ctx 为 contentCanvas 上下文，viewport 为当前视口，deltaX/deltaY 为滚动差值。
 * 返回结果：可复用时返回需补画条带；不可复用时返回 null，调用方应整层重绘。
 */
export function tryScrollBlitContent(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  deltaX: number,
  deltaY: number
): ScrollBlitResult | null {
  const dataRect = getDataAreaRect(viewport)
  const absX = Math.abs(deltaX)
  const absY = Math.abs(deltaY)

  if (dataRect.width <= 0 || dataRect.height <= 0 || (absX === 0 && absY === 0)) {
    return null
  }
  if (absX >= dataRect.width * MAX_BLIT_RATIO || absY >= dataRect.height * MAX_BLIT_RATIO) {
    return null
  }

  const copyWidth = dataRect.width - absX
  const copyHeight = dataRect.height - absY
  if (copyWidth <= 0 || copyHeight <= 0) {
    return null
  }

  const dpr = window.devicePixelRatio || 1
  const sx = (dataRect.x + Math.max(0, deltaX)) * dpr
  const sy = (dataRect.y + Math.max(0, deltaY)) * dpr
  const sw = copyWidth * dpr
  const sh = copyHeight * dpr
  const dx = (dataRect.x + Math.max(0, -deltaX)) * dpr
  const dy = (dataRect.y + Math.max(0, -deltaY)) * dpr

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(ctx.canvas, sx, sy, sw, sh, dx, dy, sw, sh)
  ctx.restore()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  return { clipRects: getScrollExposeRects(dataRect, deltaX, deltaY) }
}

/**
 * 作用：根据局部补画矩形计算需要遍历的可见行列范围。
 * 传入参数：rect 为画布逻辑坐标矩形，options 提供工作表和视口快照。
 * 返回结果：返回与该矩形相交的 1-based 行列范围；无交集时返回空范围。
 */
function getVisibleRangeForRect(rect: RenderRect, options: RenderGridOptions): VisibleRange {
  const { worksheet, viewport } = options
  const rowHeight = worksheet.defaultRowHeight
  const colWidth = worksheet.defaultColWidth
  const emptyRange: VisibleRange = {
    rowStart: 1,
    rowEnd: 0,
    colStart: 1,
    colEnd: 0,
  }

  if (rowHeight <= 0 || colWidth <= 0) {
    return emptyRange
  }

  const dirtyDataRect = intersectRect(rect, getDataAreaRect(viewport))
  if (!dirtyDataRect) {
    return emptyRange
  }

  const localLeft = dirtyDataRect.x - GRID_CHROME.headerColWidth
  const localTop = dirtyDataRect.y - GRID_CHROME.headerRowHeight
  const localRight = localLeft + dirtyDataRect.width
  const localBottom = localTop + dirtyDataRect.height
  const sheetLeft = viewport.scrollX + localLeft
  const sheetTop = viewport.scrollY + localTop
  const sheetRight = viewport.scrollX + localRight
  const sheetBottom = viewport.scrollY + localBottom

  const rowStart = Math.max(1, Math.floor(sheetTop / rowHeight) + 1)
  const rowEnd = Math.min(worksheet.rowCount, Math.ceil(sheetBottom / rowHeight))
  const colStart = Math.max(1, Math.floor(sheetLeft / colWidth) + 1)
  const colEnd = Math.min(worksheet.colCount, Math.ceil(sheetRight / colWidth))

  if (rowEnd < rowStart || colEnd < colStart) {
    return emptyRange
  }

  return { rowStart, rowEnd, colStart, colEnd }
}

/**
 * 作用：将后续绘制限制在顶部列标区域。
 * 传入参数：ctx 为 Canvas 2D 上下文，viewport 提供视口尺寸。
 * 返回结果：无返回值，通过 ctx.clip 修改当前 save 范围内的裁剪区。
 */
function clipColHeaderArea(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  const dataViewport = getDataViewportSize(viewport)
  ctx.beginPath()
  ctx.rect(headerColWidth, 0, dataViewport.width, headerRowHeight)
  ctx.clip()
}

/**
 * 作用：将后续绘制限制在左侧行号区域。
 * 传入参数：ctx 为 Canvas 2D 上下文，viewport 提供视口尺寸。
 * 返回结果：无返回值，通过 ctx.clip 修改当前 save 范围内的裁剪区。
 */
function clipRowHeaderArea(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  const dataViewport = getDataViewportSize(viewport)
  ctx.beginPath()
  ctx.rect(0, headerRowHeight, headerColWidth, dataViewport.height)
  ctx.clip()
}

/**
 * 作用：判断列标矩形是否仍在可见列标区域。
 * 传入参数：rect 为列标矩形，viewport 为当前视口。
 * 返回结果：可见返回 true，否则返回 false。
 */
function isColHeaderVisible(rect: { x: number; width: number }, viewport: Viewport): boolean {
  const right = rect.x + rect.width
  return right > GRID_CHROME.headerColWidth && rect.x < viewport.viewportWidth
}

/**
 * 作用：判断行号矩形是否仍在可见行号区域。
 * 传入参数：rect 为行号矩形，viewport 为当前视口。
 * 返回结果：可见返回 true，否则返回 false。
 */
function isRowHeaderVisible(rect: { y: number; height: number }, viewport: Viewport): boolean {
  const bottom = rect.y + rect.height
  return bottom > GRID_CHROME.headerRowHeight && rect.y < viewport.viewportHeight
}

/**
 * 作用：判断逻辑矩形是否与数据区可见范围相交。
 * 传入参数：rect 为画布逻辑坐标矩形，viewport 为当前视口。
 * 返回结果：相交返回 true，否则返回 false。
 */
function isRectInDataArea(rect: RenderRect, viewport: Viewport): boolean {
  return intersectRect(rect, getDataAreaRect(viewport)) !== null
}

/**
 * 作用：绘制单元格或表头边框。
 * 传入参数：ctx 为 Canvas 2D 上下文，矩形参数为逻辑像素，color/lineWidth 控制描边样式。
 * 返回结果：无返回值，只在当前画布描边。
 */
function strokeCellBorder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string = COLORS.gridLine,
  lineWidth: number = 1
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth

  const inset = lineWidth > 1 ? 1 : 0
  const strokeWidth = Math.max(0, width - inset * 2 - (lineWidth > 1 ? 0 : 1))
  const strokeHeight = Math.max(0, height - inset * 2 - (lineWidth > 1 ? 0 : 1))
  const offset = inset + 0.5
  ctx.strokeRect(x + offset, y + offset, strokeWidth, strokeHeight)
}

/**
 * 作用：绘制工作表白色数据区域，作为 grid 层底色。
 * 传入参数：draw 为本次绘制上下文。
 * 返回结果：无返回值，只绘制数据区背景。
 */
function drawSheetBackground(draw: DrawContext): void {
  const { ctx, worksheet, viewport, colWidth, rowHeight } = draw
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  const sheetWidth = worksheet.colCount * colWidth
  const sheetHeight = worksheet.rowCount * rowHeight
  const x = headerColWidth - viewport.scrollX
  const y = headerRowHeight - viewport.scrollY

  ctx.save()
  clipDataArea(ctx, viewport)
  ctx.fillStyle = COLORS.cellBg
  ctx.fillRect(x, y, sheetWidth, sheetHeight)
  ctx.restore()
}

/**
 * 作用：绘制行列标头背景和左上角区域。
 * 传入参数：draw 为本次绘制上下文。
 * 返回结果：无返回值，只绘制 chrome 背景。
 */
function drawChromeBackground(draw: DrawContext): void {
  const { ctx, viewport } = draw
  const { headerColWidth, headerRowHeight } = GRID_CHROME

  ctx.fillStyle = COLORS.headerBg
  ctx.fillRect(0, 0, viewport.viewportWidth, headerRowHeight)
  ctx.fillRect(0, 0, headerColWidth, viewport.viewportHeight)
}

/**
 * 作用：重绘左上角交叉单元格，盖住滚动时进入表头区域的残留。
 * 传入参数：ctx 为 Canvas 2D 上下文。
 * 返回结果：无返回值，只绘制左上角。
 */
function drawCornerCell(ctx: CanvasRenderingContext2D): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  ctx.fillStyle = COLORS.headerBg
  ctx.fillRect(0, 0, headerColWidth, headerRowHeight)
  strokeCellBorder(ctx, 0, 0, headerColWidth, headerRowHeight, COLORS.headerGridLine)
}

/**
 * 作用：绘制数据区可见单元格网格线。
 * 传入参数：draw 为本次绘制上下文。
 * 返回结果：无返回值，只绘制可见范围内的网格。
 */
function drawGridLines(draw: DrawContext): void {
  const { ctx, range, scrollX, scrollY, rowHeight, colWidth, viewport } = draw
  if (!isRangeVisible(range)) {
    return
  }

  ctx.save()
  clipDataArea(ctx, viewport)
  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    for (let col = range.colStart; col <= range.colEnd; col++) {
      const rect = getCellRect(row, col, scrollX, scrollY, rowHeight, colWidth)
      strokeCellBorder(ctx, rect.x, rect.y, rect.width, rect.height)
    }
  }
  ctx.restore()
}

/**
 * 作用：绘制行号、列标区域的可见边框。
 * 传入参数：draw 为本次绘制上下文。
 * 返回结果：无返回值，只绘制表头网格。
 */
function drawHeaderGridLines(draw: DrawContext): void {
  const { ctx, viewport, range, scrollX, scrollY, rowHeight, colWidth } = draw
  if (!isRangeVisible(range)) {
    return
  }

  strokeCellBorder(
    ctx,
    0,
    0,
    GRID_CHROME.headerColWidth,
    GRID_CHROME.headerRowHeight,
    COLORS.headerGridLine
  )

  ctx.save()
  clipColHeaderArea(ctx, viewport)
  for (let col = range.colStart; col <= range.colEnd; col++) {
    const rect = getColHeaderRect(col, scrollX, colWidth)
    if (isColHeaderVisible(rect, viewport)) {
      strokeCellBorder(ctx, rect.x, rect.y, rect.width, rect.height, COLORS.headerGridLine)
    }
  }
  ctx.restore()

  ctx.save()
  clipRowHeaderArea(ctx, viewport)
  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    const rect = getRowHeaderRect(row, scrollY, rowHeight)
    if (isRowHeaderVisible(rect, viewport)) {
      strokeCellBorder(ctx, rect.x, rect.y, rect.width, rect.height, COLORS.headerGridLine)
    }
  }
  ctx.restore()
}

/**
 * 作用：绘制表头与数据区之间的分隔线。
 * 传入参数：ctx 为 Canvas 2D 上下文，viewport 为当前视口。
 * 返回结果：无返回值，只绘制分隔线。
 */
function drawChromeDividers(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME

  ctx.strokeStyle = COLORS.headerGridLine
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(headerColWidth + 0.5, 0)
  ctx.lineTo(headerColWidth + 0.5, viewport.viewportHeight)
  ctx.moveTo(0, headerRowHeight + 0.5)
  ctx.lineTo(viewport.viewportWidth, headerRowHeight + 0.5)
  ctx.stroke()
}

/**
 * 作用：绘制可见列标和行号文本。
 * 传入参数：draw 为本次绘制上下文。
 * 返回结果：无返回值，只绘制表头文本。
 */
function drawHeaderLabels(draw: DrawContext): void {
  const { ctx, viewport, range, scrollX, scrollY, rowHeight, colWidth } = draw
  if (!isRangeVisible(range)) {
    return
  }

  ctx.fillStyle = COLORS.headerText
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  ctx.save()
  clipColHeaderArea(ctx, viewport)
  ctx.font = HEADER_FONT
  for (let col = range.colStart; col <= range.colEnd; col++) {
    const rect = getColHeaderRect(col, scrollX, colWidth)
    if (isColHeaderVisible(rect, viewport)) {
      ctx.fillText(colNumberToLetters(col), rect.x + rect.width / 2, rect.y + rect.height / 2)
    }
  }
  ctx.restore()

  ctx.save()
  clipRowHeaderArea(ctx, viewport)
  ctx.font = ROW_HEADER_FONT
  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    const rect = getRowHeaderRect(row, scrollY, rowHeight)
    if (isRowHeaderVisible(rect, viewport)) {
      ctx.fillText(String(row), rect.x + rect.width / 2, rect.y + rect.height / 2)
    }
  }
  ctx.restore()

  drawCornerCell(ctx)
}

/**
 * 作用：读取单元格背景色，未设置样式时返回 null，使 content 层保持透明。
 * 传入参数：worksheet 为工作表数据，row/col 为 1-based 行列号。
 * 返回结果：有自定义背景色返回颜色字符串，否则返回 null。
 */
function getCellBackgroundColor(worksheet: WorksheetData, row: number, col: number): string | null {
  const cell = worksheet.cells[`${row}:${col}`]
  if (!cell?.styleId) {
    return null
  }

  const style = worksheet.styles[cell.styleId]
  return style?.bgColor ?? null
}

/**
 * 作用：绘制可见单元格自定义背景色。
 * 传入参数：draw 为本次绘制上下文。
 * 返回结果：无返回值，只绘制有背景样式的单元格内部。
 */
function drawCellBackgrounds(draw: DrawContext): void {
  const { ctx, worksheet, range, scrollX, scrollY, rowHeight, colWidth } = draw
  if (!isRangeVisible(range)) {
    return
  }

  ctx.save()
  clipDataArea(ctx, draw.viewport)
  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    for (let col = range.colStart; col <= range.colEnd; col++) {
      const bgColor = getCellBackgroundColor(worksheet, row, col)
      if (!bgColor) {
        continue
      }

      const rect = getCellRect(row, col, scrollX, scrollY, rowHeight, colWidth)
      ctx.fillStyle = bgColor
      ctx.fillRect(
        rect.x + 1,
        rect.y + 1,
        Math.max(0, rect.width - 1),
        Math.max(0, rect.height - 1)
      )
    }
  }
  ctx.restore()
}

/**
 * 作用：根据单元格样式设置文字绘制状态。
 * 传入参数：ctx 为 Canvas 2D 上下文，worksheet 提供 styles，styleId 为单元格样式 ID。
 * 返回结果：无返回值，只修改当前 ctx 文本状态。
 */
function applyTextStyle(
  ctx: CanvasRenderingContext2D,
  worksheet: WorksheetData,
  styleId: string | undefined
): void {
  const style = styleId ? worksheet.styles[styleId] : undefined
  const fontSize = style?.fontSize ?? 13
  const fontFamily = style?.fontFamily ?? 'Arial, sans-serif'
  const fontWeight = style?.bold ? 'bold' : 'normal'
  const fontStyle = style?.italic ? 'italic' : 'normal'

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.fillStyle = style?.color ?? COLORS.text
  ctx.textBaseline = 'middle'
}

/**
 * 作用：根据水平对齐方式计算文本锚点 x 坐标。
 * 传入参数：rect 为单元格矩形，hAlign 为 left/center/right。
 * 返回结果：返回 Canvas fillText 使用的 x 坐标。
 */
function getTextX(
  rect: { x: number; width: number },
  hAlign: 'left' | 'center' | 'right' | undefined
): number {
  if (hAlign === 'center') {
    return rect.x + rect.width / 2
  }
  if (hAlign === 'right') {
    return rect.x + rect.width - TEXT_PADDING
  }
  return rect.x + TEXT_PADDING
}

/**
 * 作用：绘制可见单元格文本，并使用测量缓存处理超长文本。
 * 传入参数：draw 为本次绘制上下文。
 * 返回结果：无返回值，只绘制当前可见范围内的文本。
 */
function drawCellTexts(draw: DrawContext): void {
  const { ctx, worksheet, range, scrollX, scrollY, rowHeight, colWidth } = draw
  if (!isRangeVisible(range)) {
    return
  }

  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    for (let col = range.colStart; col <= range.colEnd; col++) {
      const cell = worksheet.cells[`${row}:${col}`]
      if (!cell?.value) {
        continue
      }

      const rect = getCellRect(row, col, scrollX, scrollY, rowHeight, colWidth)
      const style = cell.styleId ? worksheet.styles[cell.styleId] : undefined
      const hAlign = style?.hAlign ?? 'left'

      ctx.save()
      ctx.beginPath()
      ctx.rect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2))
      ctx.clip()

      applyTextStyle(ctx, worksheet, cell.styleId)
      ctx.textAlign = hAlign

      const maxTextWidth = Math.max(0, rect.width - TEXT_PADDING * 2)
      const text = fitTextToWidth(ctx, cell.value, maxTextWidth)
      if (text) {
        ctx.fillText(text, getTextX(rect, hAlign), rect.y + rect.height / 2)
      }
      ctx.restore()
    }
  }
}

/**
 * 作用：绘制选中单元格的背景、蓝色边框和右下角填充点。
 * 传入参数：draw 为本次绘制上下文，其中 selection 来自 Redux 选区快照。
 * 返回结果：无返回值，只绘制 overlay 层。
 */
function drawSelectionOverlay(draw: DrawContext): void {
  const { ctx, viewport, selection, worksheet, rowHeight, colWidth, scrollX, scrollY } = draw
  if (!selection) {
    return
  }

  const rowStart = Math.max(1, Math.min(selection.start.row, selection.end.row))
  const rowEnd = Math.min(worksheet.rowCount, Math.max(selection.start.row, selection.end.row))
  const colStart = Math.max(1, Math.min(selection.start.col, selection.end.col))
  const colEnd = Math.min(worksheet.colCount, Math.max(selection.start.col, selection.end.col))

  if (
    rowStart > rowEnd ||
    colStart > colEnd ||
    rowEnd < 1 ||
    colEnd < 1 ||
    rowStart > worksheet.rowCount ||
    colStart > worksheet.colCount
  ) {
    return
  }

  const startRect = getCellRect(rowStart, colStart, scrollX, scrollY, rowHeight, colWidth)
  const selectionRect: RenderRect = {
    x: startRect.x,
    y: startRect.y,
    width: (colEnd - colStart + 1) * colWidth,
    height: (rowEnd - rowStart + 1) * rowHeight,
  }

  if (!isRectInDataArea(selectionRect, viewport)) {
    return
  }

  ctx.save()
  clipDataArea(ctx, viewport)
  ctx.fillStyle = COLORS.selectionFill
  ctx.fillRect(
    selectionRect.x + 1,
    selectionRect.y + 1,
    Math.max(0, selectionRect.width - 2),
    Math.max(0, selectionRect.height - 2)
  )
  strokeCellBorder(
    ctx,
    selectionRect.x,
    selectionRect.y,
    selectionRect.width,
    selectionRect.height,
    COLORS.selectionBorder,
    2
  )

  const handleSize = 6
  const handleRect: RenderRect = {
    x: selectionRect.x + selectionRect.width - handleSize / 2,
    y: selectionRect.y + selectionRect.height - handleSize / 2,
    width: handleSize,
    height: handleSize,
  }
  if (isRectInDataArea(handleRect, viewport)) {
    ctx.fillStyle = COLORS.fillHandle
    ctx.fillRect(handleRect.x, handleRect.y, handleRect.width, handleRect.height)
  }
  ctx.restore()
}

/**
 * 作用：绘制 grid 层，包含底色、数据区网格、表头和行列标签。
 * 传入参数：ctx 为 gridCanvas 上下文，options 为工作表/视口/选区快照。
 * 返回结果：无返回值，只绘制 gridCanvas。
 */
export function renderGridLayer(ctx: CanvasRenderingContext2D, options: RenderGridOptions): void {
  const draw = createDrawContext(ctx, options)
  clearCanvas(ctx, options.viewport)
  fillCanvasBackground(ctx, options.viewport)
  drawSheetBackground(draw)
  drawChromeBackground(draw)
  drawGridLines(draw)
  drawHeaderGridLines(draw)
  drawChromeDividers(ctx, options.viewport)
  drawHeaderLabels(draw)
}

/**
 * 作用：绘制 content 层，包含可见单元格背景色和文本。
 * 传入参数：ctx 为 contentCanvas 上下文，options 为工作表/视口/选区快照。
 * 返回结果：无返回值，只绘制 contentCanvas。
 */
export function renderContentLayer(
  ctx: CanvasRenderingContext2D,
  options: RenderGridOptions,
  renderOptions: RenderContentOptions = {}
): void {
  const clipRects = renderOptions.clipRects?.filter((rect) => rect.width > 0 && rect.height > 0)
  if (!clipRects?.length) {
    const draw = createDrawContext(ctx, options)
    clearCanvas(ctx, options.viewport)
    drawCellBackgrounds(draw)
    drawCellTexts(draw)
    return
  }

  for (const rect of clipRects) {
    const range = getVisibleRangeForRect(rect, options)
    if (!isRangeVisible(range)) {
      clearRect(ctx, rect)
      continue
    }

    const draw = createDrawContext(ctx, options, range)
    clearRect(ctx, rect)
    ctx.save()
    clipRect(ctx, rect)
    drawCellBackgrounds(draw)
    drawCellTexts(draw)
    ctx.restore()
  }
}

/**
 * 作用：绘制 overlay 层，包含选区视觉效果。
 * 传入参数：ctx 为 overlayCanvas 上下文，options 为工作表/视口/选区快照。
 * 返回结果：无返回值，只绘制 overlayCanvas。
 */
export function renderOverlayLayer(
  ctx: CanvasRenderingContext2D,
  options: RenderGridOptions
): void {
  const draw = createDrawContext(ctx, options)
  clearCanvas(ctx, options.viewport)
  drawSelectionOverlay(draw)
}

/**
 * 作用：兼容旧的单 Canvas 渲染入口，按 grid/content/overlay 顺序绘制到同一个 ctx。
 * 传入参数：ctx 为 Canvas 2D 上下文，options 为工作表/视口/选区快照。
 * 返回结果：无返回值，只绘制传入的画布。
 */
export function renderGrid(ctx: CanvasRenderingContext2D, options: RenderGridOptions): void {
  renderGridLayer(ctx, options)
  renderContentLayer(ctx, options)
  renderOverlayLayer(ctx, options)
}
