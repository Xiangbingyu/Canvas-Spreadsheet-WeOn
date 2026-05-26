// Coordinate hit-testing utilities shared by canvas event adapters.
import type { CellCoord, RenderConfig, ViewportState } from '@/spreadsheet/model/types'

export type SheetHitTarget =
  | { type: 'cell'; coord: CellCoord }
  | { type: 'column-header'; col: number }
  | { type: 'row-header'; row: number }
  | { type: 'corner' }
  | { type: 'blank' }

export function getCellAtPoint(
  x: number,
  y: number,
  viewport: ViewportState,
  config: Required<RenderConfig>,
  rowCount: number,
  colCount: number,
  options: { clampToViewport?: boolean } = {}
): CellCoord | null {
  if (options.clampToViewport) {
    return getClampedCellAtPoint(x, y, viewport, config, rowCount, colCount)
  }

  if (x < config.headerWidth || y < config.headerHeight) {
    return null
  }

  const col = Math.floor((x - config.headerWidth + viewport.scrollX) / config.colWidth)
  const row = Math.floor((y - config.headerHeight + viewport.scrollY) / config.rowHeight)

  if (row < 0 || row >= rowCount || col < 0 || col >= colCount) {
    return null
  }

  return { row, col }
}

export function getSheetHitTarget(
  x: number,
  y: number,
  viewport: ViewportState,
  config: Required<RenderConfig>,
  rowCount: number,
  colCount: number
): SheetHitTarget {
  if (x < config.headerWidth && y < config.headerHeight) {
    return { type: 'corner' }
  }

  if (y < config.headerHeight && x >= config.headerWidth) {
    const col = Math.floor((x - config.headerWidth + viewport.scrollX) / config.colWidth)
    if (col >= 0 && col < colCount) {
      return { type: 'column-header', col }
    }
    return { type: 'blank' }
  }

  if (x < config.headerWidth && y >= config.headerHeight) {
    const row = Math.floor((y - config.headerHeight + viewport.scrollY) / config.rowHeight)
    if (row >= 0 && row < rowCount) {
      return { type: 'row-header', row }
    }
    return { type: 'blank' }
  }

  const coord = getCellAtPoint(x, y, viewport, config, rowCount, colCount)
  return coord ? { type: 'cell', coord } : { type: 'blank' }
}

function getClampedCellAtPoint(
  x: number,
  y: number,
  viewport: ViewportState,
  config: Required<RenderConfig>,
  rowCount: number,
  colCount: number
): CellCoord | null {
  if (
    rowCount <= 0 ||
    colCount <= 0 ||
    viewport.width <= config.headerWidth ||
    viewport.height <= config.headerHeight
  ) {
    return null
  }

  const clampedX = clamp(x, config.headerWidth, viewport.width - 1)
  const clampedY = clamp(y, config.headerHeight, viewport.height - 1)
  const col = clamp(
    Math.floor((clampedX - config.headerWidth + viewport.scrollX) / config.colWidth),
    0,
    colCount - 1
  )
  const row = clamp(
    Math.floor((clampedY - config.headerHeight + viewport.scrollY) / config.rowHeight),
    0,
    rowCount - 1
  )

  return { row, col }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
