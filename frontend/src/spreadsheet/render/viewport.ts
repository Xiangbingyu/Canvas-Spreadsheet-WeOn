// 纯函数：视口、可见范围、坐标换算

import { GRID_CHROME } from '@/spreadsheet/utils/coordinates'

/** 视口状态（Canvas 逻辑像素坐标系） */
export type Viewport = {
  scrollX: number // 水平滚动偏移，≥0
  scrollY: number // 垂直滚动偏移，≥0
  viewportWidth: number // 视口宽度（含行列标头）
  viewportHeight: number // 视口高度（含行列标头）
}

/** 当前可见的行列区间（1-based，含首尾） */
export type VisibleRange = {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
}

/** Canvas 逻辑像素矩形，用于局部重绘范围计算。 */
export type ViewportRect = {
  x: number
  y: number
  width: number
  height: number
}

function createEmptyVisibleRange(): VisibleRange {
  return {
    rowStart: 1,
    rowEnd: 0,
    colStart: 1,
    colEnd: 0,
  }
}

/**
 * 创建初始视口
 * @returns 滚动为 0、尺寸为 0 的视口对象
 */
export function createViewport(): Viewport {
  const viewport: Viewport = {
    scrollX: 0,
    scrollY: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  }
  return viewport
}

/** 数据区视口尺寸（扣除冻结行列标头） */
export function getDataViewportSize(viewport: Viewport): {
  width: number
  height: number
} {
  return {
    width: Math.max(0, viewport.viewportWidth - GRID_CHROME.headerColWidth),
    height: Math.max(0, viewport.viewportHeight - GRID_CHROME.headerRowHeight),
  }
}

/**
 * 计算整张工作表的像素尺寸
 * @param rowCount 总行数
 * @param colCount 总列数
 * @param rowHeight 行高（px）
 * @param colWidth 列宽（px）
 * @returns 表的总宽度与总高度
 */
export function getSheetSize(
  rowCount: number,
  colCount: number,
  rowHeight: number,
  colWidth: number
): { width: number; height: number } {
  const width = colCount * colWidth
  const height = rowCount * rowHeight
  return { width, height }
}

/**
 * 将滚动偏移限制在合法范围内
 * @param scrollX 待限制的水平滚动
 * @param scrollY 待限制的垂直滚动
 * @param viewportWidth 数据区视口宽度
 * @param viewportHeight 数据区视口高度
 * @param sheetWidth 工作表总宽度
 * @param sheetHeight 工作表总高度
 * @returns 限制后的 scrollX、scrollY
 */
export function clampScroll(
  scrollX: number,
  scrollY: number,
  viewportWidth: number,
  viewportHeight: number,
  sheetWidth: number,
  sheetHeight: number
): { scrollX: number; scrollY: number } {
  const maxScrollX = Math.max(0, sheetWidth - viewportWidth)
  const maxScrollY = Math.max(0, sheetHeight - viewportHeight)

  let nextScrollX = scrollX
  if (nextScrollX < 0) {
    nextScrollX = 0
  } else if (nextScrollX > maxScrollX) {
    nextScrollX = maxScrollX
  }

  let nextScrollY = scrollY
  if (nextScrollY < 0) {
    nextScrollY = 0
  } else if (nextScrollY > maxScrollY) {
    nextScrollY = maxScrollY
  }

  return { scrollX: nextScrollX, scrollY: nextScrollY }
}

/**
 * 根据视口与网格尺寸，计算当前应绘制的行列范围
 * @param viewport 视口（含滚动与尺寸）
 * @param rowHeight 行高（px）
 * @param colWidth 列宽（px）
 * @param rowCount 工作表总行数
 * @param colCount 工作表总列数
 * @returns 可见行/列的起止索引；不可见时 rowEnd < rowStart
 */
export function getVisibleRange(
  viewport: Viewport,
  rowHeight: number,
  colWidth: number,
  rowCount: number,
  colCount: number
): VisibleRange {
  const emptyRange = createEmptyVisibleRange()

  if (rowCount <= 0 || colCount <= 0) {
    return emptyRange
  }

  const dataViewport = getDataViewportSize(viewport)
  if (dataViewport.width <= 0 || dataViewport.height <= 0) {
    return emptyRange
  }

  if (rowHeight <= 0 || colWidth <= 0) {
    return emptyRange
  }

  const { scrollX, scrollY } = viewport

  let rowStart = Math.floor(scrollY / rowHeight) + 1
  if (rowStart < 1) {
    rowStart = 1
  }
  if (rowStart > rowCount) {
    rowStart = rowCount + 1
  }

  let rowEnd = Math.ceil((scrollY + dataViewport.height) / rowHeight)
  if (rowEnd > rowCount) {
    rowEnd = rowCount
  }
  if (rowEnd < 1) {
    rowEnd = 0
  }

  let colStart = Math.floor(scrollX / colWidth) + 1
  if (colStart < 1) {
    colStart = 1
  }
  if (colStart > colCount) {
    colStart = colCount + 1
  }

  let colEnd = Math.ceil((scrollX + dataViewport.width) / colWidth)
  if (colEnd > colCount) {
    colEnd = colCount
  }
  if (colEnd < 1) {
    colEnd = 0
  }

  if (rowEnd < rowStart || colEnd < colStart) {
    return emptyRange
  }

  const range: VisibleRange = {
    rowStart,
    rowEnd,
    colStart,
    colEnd,
  }
  return range
}

/**
 * 作用：根据 Canvas 逻辑像素矩形计算该矩形覆盖的可见行列范围，用于 content 层 dirty-rect 局部重绘。
 * 传入参数：rect 为 Canvas 坐标矩形；viewport 为当前视口；行高列宽和总行列数来自 WorksheetData。
 * 返回结果：返回 1-based 可见行列范围；不相交时返回 rowEnd < rowStart 的空范围。
 */
export function getVisibleRangeForRect(
  rect: ViewportRect,
  viewport: Viewport,
  rowHeight: number,
  colWidth: number,
  rowCount: number,
  colCount: number
): VisibleRange {
  const emptyRange = createEmptyVisibleRange()

  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rowCount <= 0 ||
    colCount <= 0 ||
    rowHeight <= 0 ||
    colWidth <= 0
  ) {
    return emptyRange
  }

  const dataViewport = getDataViewportSize(viewport)
  const dataLeft = GRID_CHROME.headerColWidth
  const dataTop = GRID_CHROME.headerRowHeight
  const dataRight = dataLeft + dataViewport.width
  const dataBottom = dataTop + dataViewport.height

  const left = Math.max(rect.x, dataLeft)
  const top = Math.max(rect.y, dataTop)
  const right = Math.min(rect.x + rect.width, dataRight)
  const bottom = Math.min(rect.y + rect.height, dataBottom)

  if (right <= left || bottom <= top) {
    return emptyRange
  }

  const sheetLeft = viewport.scrollX + (left - dataLeft)
  const sheetRight = viewport.scrollX + (right - dataLeft)
  const sheetTop = viewport.scrollY + (top - dataTop)
  const sheetBottom = viewport.scrollY + (bottom - dataTop)

  const rowStart = Math.max(1, Math.floor(sheetTop / rowHeight) + 1)
  const rowEnd = Math.min(rowCount, Math.ceil(sheetBottom / rowHeight))
  const colStart = Math.max(1, Math.floor(sheetLeft / colWidth) + 1)
  const colEnd = Math.min(colCount, Math.ceil(sheetRight / colWidth))

  if (rowEnd < rowStart || colEnd < colStart) {
    return emptyRange
  }

  return { rowStart, rowEnd, colStart, colEnd }
}

/**
 * 将单元格行列号转换为画布上的矩形（含表头偏移，已扣除滚动）
 * @param row 行号，从 1 开始
 * @param col 列号，从 1 开始
 * @param scrollX 水平滚动偏移
 * @param scrollY 垂直滚动偏移
 * @param rowHeight 行高（px）
 * @param colWidth 列宽（px）
 * @returns 单元格在画布上的 x、y、width、height
 */
export function getCellRect(
  row: number,
  col: number,
  scrollX: number,
  scrollY: number,
  rowHeight: number,
  colWidth: number
): { x: number; y: number; width: number; height: number } {
  const { headerColWidth, headerRowHeight } = GRID_CHROME

  const x = headerColWidth + (col - 1) * colWidth - scrollX
  const y = headerRowHeight + (row - 1) * rowHeight - scrollY

  const rect = {
    x,
    y,
    width: colWidth,
    height: rowHeight,
  }
  return rect
}

/** 列标单元格矩形 */
export function getColHeaderRect(
  col: number,
  scrollX: number,
  colWidth: number
): { x: number; y: number; width: number; height: number } {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  return {
    x: headerColWidth + (col - 1) * colWidth - scrollX,
    y: 0,
    width: colWidth,
    height: headerRowHeight,
  }
}

/** 行号单元格矩形 */
export function getRowHeaderRect(
  row: number,
  scrollY: number,
  rowHeight: number
): { x: number; y: number; width: number; height: number } {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  return {
    x: 0,
    y: headerRowHeight + (row - 1) * rowHeight - scrollY,
    width: headerColWidth,
    height: rowHeight,
  }
}
