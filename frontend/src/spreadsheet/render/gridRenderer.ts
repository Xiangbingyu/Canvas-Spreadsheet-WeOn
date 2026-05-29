/**
 * gridRenderer — Canvas 表格绘制（纯函数，不依赖 React / Redux）
 *
 * 绘制逻辑（按顺序执行，后一步可能覆盖前一步）：
 * 1. clearScreen           用画布底色铺满整个视口
 * 2. drawChromeBackground  行列标头灰底 + 左上角
 * 3. drawSheetBackground   数据区白底
 * 4. drawCellBackgrounds   可见格背景（含 styles.bgColor）
 * 5. drawGridLines         数据区网格线（选中格蓝色）
 * 6. drawHeaderGridLines   行列标头边框
 * 7. drawChromeDividers    标头与数据区分割线
 * 8. drawHeaderLabels      列标 A/B/C…、行号 1/2/3…
 * 9. drawCellTexts         单元格文字（clip 裁剪）
 *
 * 仅遍历 getVisibleRange 返回的可见行列，不绘制整张表。
 * 单元格坐标统一由 viewport.getCellRect 计算。
 */

import type { WorksheetData } from '@/spreadsheet/model/types'
import { colNumberToLetters, GRID_CHROME } from './chrome'
import {
  getCellRect,
  getColHeaderRect,
  getDataViewportSize,
  getRowHeaderRect,
  getVisibleRange,
  type Viewport,
  type VisibleRange,
} from './viewport'

/** 当前选中的单元格（1-based）；无选中传 null */
export type GridSelection = { row: number; col: number } | null

/**
 * renderGrid 的入参
 * - worksheet: Redux 中的工作表数据
 * - viewport:  滚动与视口尺寸
 * - selection: 选中格，用于绘制蓝色边框
 */
export type RenderGridOptions = {
  worksheet: WorksheetData
  viewport: Viewport
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
  text: '#202124',
} as const

const TEXT_PADDING = 2
const HEADER_FONT = '500 11px Roboto, Arial, sans-serif'
const ROW_HEADER_FONT = '11px Roboto, Arial, sans-serif'

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

function isRangeVisible(range: VisibleRange): boolean {
  return range.rowEnd >= range.rowStart && range.colEnd >= range.colStart
}

/**
 * 1. 清屏
 * @param ctx      Canvas 2D 上下文
 * @param viewport 视口（取 viewportWidth / viewportHeight）
 * @returns void
 * @作用 用 canvasBg 铺满整个可见区域
 */
function clearScreen(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  ctx.fillStyle = COLORS.canvasBg
  ctx.fillRect(0, 0, viewport.viewportWidth, viewport.viewportHeight)
}

function clipDataArea(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  const dataViewport = getDataViewportSize(viewport)
  ctx.beginPath()
  ctx.rect(headerColWidth, headerRowHeight, dataViewport.width, dataViewport.height)
  ctx.clip()
}

/** 列标区域：顶部条带（不含左上角） */
function clipColHeaderArea(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  const dataViewport = getDataViewportSize(viewport)
  ctx.beginPath()
  ctx.rect(headerColWidth, 0, dataViewport.width, headerRowHeight)
  ctx.clip()
}

/** 行号区域：左侧条带（不含左上角） */
function clipRowHeaderArea(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  const dataViewport = getDataViewportSize(viewport)
  ctx.beginPath()
  ctx.rect(0, headerRowHeight, headerColWidth, dataViewport.height)
  ctx.clip()
}

function isColHeaderVisible(
  rect: { x: number; y: number; width: number; height: number },
  viewport: Viewport
): boolean {
  const { headerColWidth } = GRID_CHROME
  const right = rect.x + rect.width
  const visibleRight = viewport.viewportWidth
  return right > headerColWidth && rect.x < visibleRight
}

function isRowHeaderVisible(
  rect: { x: number; y: number; width: number; height: number },
  viewport: Viewport
): boolean {
  const { headerRowHeight } = GRID_CHROME
  const bottom = rect.y + rect.height
  const visibleBottom = viewport.viewportHeight
  return bottom > headerRowHeight && rect.y < visibleBottom
}

/** 重绘左上角，防止标头文字/边框滚入时残留 */
function drawCornerCell(ctx: CanvasRenderingContext2D): void {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  ctx.fillStyle = COLORS.headerBg
  ctx.fillRect(0, 0, headerColWidth, headerRowHeight)
  strokeCellBorder(ctx, 0, 0, headerColWidth, headerRowHeight, COLORS.headerGridLine)
}

/**
 * 绘制行列标头背景（含左上角）
 * @param draw 绘制上下文
 */
function drawChromeBackground(draw: DrawContext): void {
  const { ctx, viewport } = draw
  const { headerColWidth, headerRowHeight } = GRID_CHROME

  ctx.fillStyle = COLORS.headerBg
  ctx.fillRect(0, 0, viewport.viewportWidth, headerRowHeight)
  ctx.fillRect(0, 0, headerColWidth, viewport.viewportHeight)
}

/**
 * 铺工作表整体白底
 * @param draw 绘制上下文
 * @returns void
 * @作用 在表坐标系下画一块白色矩形，表比视口小时仍显示完整白区
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
 * 取单元格背景色
 * @param worksheet 工作表
 * @param row       行号（1-based）
 * @param col       列号（1-based）
 * @returns 该格背景色字符串
 */
function getCellBackgroundColor(worksheet: WorksheetData, row: number, col: number): string {
  const key = `${row}:${col}`
  const cell = worksheet.cells[key]
  if (!cell?.styleId) {
    return COLORS.cellBg
  }

  const style = worksheet.styles[cell.styleId]
  if (style?.bgColor) {
    return style.bgColor
  }

  return COLORS.cellBg
}

/**
 * 绘制可见单元格背景与选中高亮
 * @param draw 绘制上下文
 * @returns void
 * @作用 遍历可见 range，fillRect 各格背景
 */
function drawCellBackgrounds(draw: DrawContext): void {
  const { ctx, worksheet, range, scrollX, scrollY, rowHeight, colWidth } = draw

  //如果可见范围不可见，则返回
  if (!isRangeVisible(range)) {
    return
  }

  ctx.save()
  clipDataArea(ctx, draw.viewport)

  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    for (let col = range.colStart; col <= range.colEnd; col++) {
      const rect = getCellRect(row, col, scrollX, scrollY, rowHeight, colWidth)
      const bgColor = getCellBackgroundColor(worksheet, row, col)
      ctx.fillStyle = bgColor
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    }
  }

  ctx.restore()
}

/**
 * 绘制单格边框
 * @param ctx    Canvas 2D 上下文
 * @param x      左上角 x
 * @param y      左上角 y
 * @param width  格宽
 * @param height 格高
 * @returns void
 * @作用 strokeRect 画 1px 网格线（+0.5 像素对齐）
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
 * 绘制可见区域网格线
 * @param draw 绘制上下文
 * @returns void
 * @作用 对每个可见格描边；选中格使用蓝色 2px，其余为灰色 1px
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
    if (!isColHeaderVisible(rect, viewport)) {
      continue
    }
    strokeCellBorder(ctx, rect.x, rect.y, rect.width, rect.height, COLORS.headerGridLine)
  }
  ctx.restore()

  ctx.save()
  clipRowHeaderArea(ctx, viewport)
  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    const rect = getRowHeaderRect(row, scrollY, rowHeight)
    if (!isRowHeaderVisible(rect, viewport)) {
      continue
    }
    strokeCellBorder(ctx, rect.x, rect.y, rect.width, rect.height, COLORS.headerGridLine)
  }
  ctx.restore()
}

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
    if (!isColHeaderVisible(rect, viewport)) {
      continue
    }
    ctx.fillText(colNumberToLetters(col), rect.x + rect.width / 2, rect.y + rect.height / 2)
  }
  ctx.restore()

  ctx.save()
  clipRowHeaderArea(ctx, viewport)
  ctx.font = ROW_HEADER_FONT
  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    const rect = getRowHeaderRect(row, scrollY, rowHeight)
    if (!isRowHeaderVisible(rect, viewport)) {
      continue
    }
    ctx.fillText(String(row), rect.x + rect.width / 2, rect.y + rect.height / 2)
  }
  ctx.restore()

  drawCornerCell(ctx)
}

function drawGridLines(draw: DrawContext): void {
  const { ctx, range, scrollX, scrollY, rowHeight, colWidth, selection, viewport } = draw

  if (!isRangeVisible(range)) {
    return
  }

  ctx.save()
  clipDataArea(ctx, viewport)

  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    for (let col = range.colStart; col <= range.colEnd; col++) {
      const rect = getCellRect(row, col, scrollX, scrollY, rowHeight, colWidth)
      const isSelected = selection !== null && selection.row === row && selection.col === col

      if (isSelected) {
        strokeCellBorder(ctx, rect.x, rect.y, rect.width, rect.height, COLORS.selectionBorder, 2)
      } else {
        strokeCellBorder(ctx, rect.x, rect.y, rect.width, rect.height)
      }
    }
  }

  ctx.restore()
}

/**
 * 根据样式设置 ctx 字体
 * @param ctx       Canvas 2D 上下文
 * @param worksheet 工作表（取 styles）
 * @param styleId   样式 ID，可为空
 * @returns void
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

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.fillStyle = style?.color ?? COLORS.text
  ctx.textBaseline = 'middle'
}

/**
 * 计算文字绘制的 x 坐标
 * @param rect   单元格矩形
 * @param hAlign 水平对齐
 * @returns 文字锚点 x
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
 * 绘制可见单元格文字
 * @param draw 绘制上下文
 * @returns void
 * @作用 对有 value 的格 clip 后 fillText，避免文字画出格外
 */
function drawCellTexts(draw: DrawContext): void {
  const { ctx, worksheet, range, scrollX, scrollY, rowHeight, colWidth } = draw

  if (!isRangeVisible(range)) {
    return
  }

  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    for (let col = range.colStart; col <= range.colEnd; col++) {
      const key = `${row}:${col}`
      const cell = worksheet.cells[key]
      if (!cell?.value) {
        continue
      }

      const rect = getCellRect(row, col, scrollX, scrollY, rowHeight, colWidth)
      const style = cell.styleId ? worksheet.styles[cell.styleId] : undefined
      const hAlign = style?.hAlign ?? 'left'

      ctx.save()

      ctx.beginPath()
      ctx.rect(rect.x, rect.y, rect.width, rect.height)
      ctx.clip()

      applyTextStyle(ctx, worksheet, cell.styleId)
      ctx.textAlign = hAlign

      const textX = getTextX(rect, hAlign)
      const textY = rect.y + rect.height / 2
      ctx.fillText(cell.value, textX, textY)

      ctx.restore()
    }
  }
}

/**
 * 渲染入口 — 由 GrideCanvas.paint 调用
 * @param ctx     Canvas 2D 上下文（已设置 devicePixelRatio 变换）
 * @param options worksheet + viewport + selection
 * @returns void
 * @作用 按顶部绘制顺序依次调用各绘制函数
 */
export function renderGrid(ctx: CanvasRenderingContext2D, options: RenderGridOptions): void {
  const { worksheet, viewport, selection } = options

  const rowHeight = worksheet.defaultRowHeight
  const colWidth = worksheet.defaultColWidth
  const scrollX = viewport.scrollX
  const scrollY = viewport.scrollY

  //计算当前可见范围 {rowStart, rowEnd, colStart, colEnd} 1-based 行/列索引，含首尾
  const range = getVisibleRange(
    viewport,
    rowHeight,
    colWidth,
    worksheet.rowCount,
    worksheet.colCount
  )
  //绘制上下文
  const draw: DrawContext = {
    ctx, //Canvas 2D 上下文
    worksheet, //工作表数据
    viewport, //视口
    range, //可见范围
    rowHeight, //行高
    colWidth, //列宽
    scrollX, //水平滚动位置
    scrollY, //垂直滚动位置
    selection, //选中格子
  }

  clearScreen(ctx, viewport)
  drawChromeBackground(draw)
  drawSheetBackground(draw)
  drawCellBackgrounds(draw)
  drawGridLines(draw)
  drawHeaderGridLines(draw)
  drawChromeDividers(ctx, viewport)
  drawHeaderLabels(draw)
  drawCellTexts(draw)
}
