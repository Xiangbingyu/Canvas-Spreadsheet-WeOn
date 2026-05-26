// Viewport math for total sheet size and visible row/column ranges.
import type { RenderConfig, ViewportState } from '@/spreadsheet/model/types'

export interface VisibleRange {
  firstRow: number
  lastRow: number
  firstCol: number
  lastCol: number
}

export function getTotalSize(rowCount: number, colCount: number, config: Required<RenderConfig>) {
  return {
    width: config.headerWidth + colCount * config.colWidth,
    height: config.headerHeight + rowCount * config.rowHeight,
  }
}

export function getVisibleRange(
  rowCount: number,
  colCount: number,
  viewport: ViewportState,
  config: Required<RenderConfig>
): VisibleRange {
  const bodyWidth = Math.max(0, viewport.width - config.headerWidth)
  const bodyHeight = Math.max(0, viewport.height - config.headerHeight)

  const firstCol = clamp(Math.floor(viewport.scrollX / config.colWidth), 0, colCount - 1)
  const lastCol = clamp(
    Math.ceil((viewport.scrollX + bodyWidth) / config.colWidth),
    firstCol,
    colCount - 1
  )
  const firstRow = clamp(Math.floor(viewport.scrollY / config.rowHeight), 0, rowCount - 1)
  const lastRow = clamp(
    Math.ceil((viewport.scrollY + bodyHeight) / config.rowHeight),
    firstRow,
    rowCount - 1
  )

  return { firstRow, lastRow, firstCol, lastCol }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}
