// Layered Canvas renderer for grid, content, and overlay drawing.
// Input: worksheet/viewport/selection snapshot; output: pixels drawn on canvas layers.

import type { WorksheetData } from '@/spreadsheet/model/types'
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

export type GridSelection = { row: number; col: number } | null

export type RenderGridOptions = {
  worksheet: WorksheetData
  viewport: Viewport
  selection: GridSelection
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
function createDrawContext(ctx: CanvasRenderingContext2D, options: RenderGridOptions): DrawContext {
  const { worksheet, viewport, selection } = options
  const rowHeight = worksheet.defaultRowHeight
  const colWidth = worksheet.defaultColWidth
  const range = getVisibleRange(
    viewport,
    rowHeight,
    colWidth,
    worksheet.rowCount,
    worksheet.colCount
  )

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
  if (
    selection.row < 1 ||
    selection.col < 1 ||
    selection.row > worksheet.rowCount ||
    selection.col > worksheet.colCount
  ) {
    return
  }

  const rect = getCellRect(selection.row, selection.col, scrollX, scrollY, rowHeight, colWidth)
  const dataViewport = getDataViewportSize(viewport)
  const dataLeft = GRID_CHROME.headerColWidth
  const dataTop = GRID_CHROME.headerRowHeight
  const dataRight = dataLeft + dataViewport.width
  const dataBottom = dataTop + dataViewport.height
  const rectRight = rect.x + rect.width
  const rectBottom = rect.y + rect.height

  if (
    rectRight <= dataLeft ||
    rect.x >= dataRight ||
    rectBottom <= dataTop ||
    rect.y >= dataBottom
  ) {
    return
  }

  ctx.save()
  clipDataArea(ctx, viewport)
  ctx.fillStyle = COLORS.selectionFill
  ctx.fillRect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2))
  strokeCellBorder(ctx, rect.x, rect.y, rect.width, rect.height, COLORS.selectionBorder, 2)

  const handleSize = 6
  ctx.fillStyle = COLORS.fillHandle
  ctx.fillRect(
    rect.x + rect.width - handleSize / 2,
    rect.y + rect.height - handleSize / 2,
    handleSize,
    handleSize
  )
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
  options: RenderGridOptions
): void {
  const draw = createDrawContext(ctx, options)
  clearCanvas(ctx, options.viewport)
  drawCellBackgrounds(draw)
  drawCellTexts(draw)
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
