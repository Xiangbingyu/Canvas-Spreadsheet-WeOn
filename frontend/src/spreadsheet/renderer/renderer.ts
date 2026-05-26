// Pure Canvas 2D renderer for grids, cell backgrounds, text, headers, and selection overlays.
// This module does not mutate state or handle editing, websocket, undo, or redo logic.
import {
  cellKey,
  columnLabel,
  DEFAULT_CONFIG,
  type Cell,
  type CellCoord,
  type RenderConfig,
  type SelectionRange,
  type Style,
  type ViewportState,
} from '@/spreadsheet/model/types'
import { containsCell, normalizeRange } from '@/spreadsheet/utils/range'
import { getVisibleRange } from './viewport'

export interface RenderSpreadsheetOptions {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  rowCount: number
  colCount: number
  cells: Record<string, Cell>
  styles?: Record<string, Style>
  selection: SelectionRange
  editingCell?: CellCoord | null
  viewport: ViewportState
  config?: RenderConfig
}

const COLORS = {
  background: '#ffffff',
  headerBackground: '#f8f9fa',
  headerSelected: '#d2e3fc',
  headerText: '#70757a',
  headerSelectedText: '#174ea6',
  grid: '#e0e0e0',
  headerGrid: '#dadce0',
  text: '#202124',
  selection: '#1a73e8',
  selectionFill: 'rgba(26, 115, 232, 0.08)',
}

export function renderSpreadsheet(options: RenderSpreadsheetOptions) {
  const config = { ...DEFAULT_CONFIG, ...options.config }
  const { ctx, viewport } = options

  ctx.save()
  ctx.clearRect(0, 0, options.width, options.height)
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, options.width, options.height)

  const visible = getVisibleRange(options.rowCount, options.colCount, viewport, config)

  drawCells(options, config, visible)
  drawGrid(options, config, visible)
  drawText(options, config, visible)
  drawSelection(options, config)
  drawHeaders(options, config, visible)
  ctx.restore()
}

function drawCells(
  options: RenderSpreadsheetOptions,
  config: Required<RenderConfig>,
  visible: ReturnType<typeof getVisibleRange>
) {
  const { ctx, cells, styles } = options

  for (let row = visible.firstRow; row <= visible.lastRow; row += 1) {
    for (let col = visible.firstCol; col <= visible.lastCol; col += 1) {
      const coord = { row, col }
      const cell = cells[cellKey(coord)]
      const style = resolveStyle(cell, styles)
      const rect = getCellViewportRect(coord, options.viewport, config)

      if (style.bgColor) {
        ctx.fillStyle = style.bgColor
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      }

      if (containsCell(options.selection, coord)) {
        ctx.fillStyle = COLORS.selectionFill
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      }
    }
  }
}

function drawGrid(
  options: RenderSpreadsheetOptions,
  config: Required<RenderConfig>,
  visible: ReturnType<typeof getVisibleRange>
) {
  const { ctx, viewport } = options
  const left = config.headerWidth
  const top = config.headerHeight
  const right = options.width
  const bottom = options.height

  ctx.beginPath()
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1

  for (let col = visible.firstCol; col <= visible.lastCol + 1; col += 1) {
    const x = alignPixel(config.headerWidth + col * config.colWidth - viewport.scrollX)
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
  }

  for (let row = visible.firstRow; row <= visible.lastRow + 1; row += 1) {
    const y = alignPixel(config.headerHeight + row * config.rowHeight - viewport.scrollY)
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
  }

  ctx.stroke()
}

function drawText(
  options: RenderSpreadsheetOptions,
  config: Required<RenderConfig>,
  visible: ReturnType<typeof getVisibleRange>
) {
  const { ctx, cells, styles } = options

  for (let row = visible.firstRow; row <= visible.lastRow; row += 1) {
    for (let col = visible.firstCol; col <= visible.lastCol; col += 1) {
      const coord = { row, col }
      const cell = cells[cellKey(coord)]
      if (!cell?.value) {
        continue
      }

      const style = resolveStyle(cell, styles)
      const rect = getCellViewportRect(coord, options.viewport, config)
      const fontSize = style.fontSize ?? 13
      const paddingX = 8

      ctx.save()
      ctx.beginPath()
      ctx.rect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2)
      ctx.clip()
      ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '} ${fontSize}px ${style.fontFamily ?? 'Arial, sans-serif'}`
      ctx.fillStyle = style.color ?? COLORS.text
      ctx.textBaseline = 'middle'
      ctx.textAlign = style.hAlign ?? 'left'

      const textX = getTextX(rect.x, rect.width, paddingX, style.hAlign)
      const textY = rect.y + rect.height / 2
      ctx.fillText(cell.value, textX, textY)

      if (style.underline) {
        const metrics = ctx.measureText(cell.value)
        const underlineY = textY + fontSize / 2 - 2
        const startX = getUnderlineStartX(textX, metrics.width, style.hAlign)
        ctx.beginPath()
        ctx.strokeStyle = style.color ?? COLORS.text
        ctx.moveTo(startX, underlineY)
        ctx.lineTo(startX + metrics.width, underlineY)
        ctx.stroke()
      }
      ctx.restore()
    }
  }
}

function drawSelection(options: RenderSpreadsheetOptions, config: Required<RenderConfig>) {
  const { ctx, selection, viewport } = options
  const normalized = normalizeRange(selection)
  const x = config.headerWidth + normalized.start.col * config.colWidth - viewport.scrollX
  const y = config.headerHeight + normalized.start.row * config.rowHeight - viewport.scrollY
  const width = (normalized.end.col - normalized.start.col + 1) * config.colWidth
  const height = (normalized.end.row - normalized.start.row + 1) * config.rowHeight

  ctx.save()
  ctx.strokeStyle = COLORS.selection
  ctx.lineWidth = 2
  ctx.strokeRect(alignPixel(x), alignPixel(y), width, height)
  ctx.fillStyle = COLORS.selection
  ctx.fillRect(x + width - 4, y + height - 4, 7, 7)

  if (options.editingCell) {
    const rect = getCellViewportRect(options.editingCell, viewport, config)
    ctx.setLineDash([4, 3])
    ctx.strokeRect(alignPixel(rect.x + 2), alignPixel(rect.y + 2), rect.width - 4, rect.height - 4)
  }
  ctx.restore()
}

function drawHeaders(
  options: RenderSpreadsheetOptions,
  config: Required<RenderConfig>,
  visible: ReturnType<typeof getVisibleRange>
) {
  const { ctx, viewport } = options
  const normalizedSelection = normalizeRange(options.selection)

  ctx.fillStyle = COLORS.headerBackground
  ctx.fillRect(0, 0, options.width, config.headerHeight)
  ctx.fillRect(0, 0, config.headerWidth, options.height)

  for (let col = visible.firstCol; col <= visible.lastCol; col += 1) {
    if (
      normalizedSelection.start.col <= col &&
      normalizedSelection.end.col >= col &&
      normalizedSelection.start.row === 0 &&
      normalizedSelection.end.row === options.rowCount - 1
    ) {
      const x = config.headerWidth + col * config.colWidth - viewport.scrollX
      ctx.fillStyle = COLORS.headerSelected
      ctx.fillRect(x, 0, config.colWidth, config.headerHeight)
    }
  }

  for (let row = visible.firstRow; row <= visible.lastRow; row += 1) {
    if (
      normalizedSelection.start.row <= row &&
      normalizedSelection.end.row >= row &&
      normalizedSelection.start.col === 0 &&
      normalizedSelection.end.col === options.colCount - 1
    ) {
      const y = config.headerHeight + row * config.rowHeight - viewport.scrollY
      ctx.fillStyle = COLORS.headerSelected
      ctx.fillRect(0, y, config.headerWidth, config.rowHeight)
    }
  }

  ctx.strokeStyle = COLORS.headerGrid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, alignPixel(config.headerHeight))
  ctx.lineTo(options.width, alignPixel(config.headerHeight))
  ctx.moveTo(alignPixel(config.headerWidth), 0)
  ctx.lineTo(alignPixel(config.headerWidth), options.height)
  ctx.stroke()

  ctx.font = '500 11px Arial, sans-serif'
  ctx.fillStyle = COLORS.headerText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let col = visible.firstCol; col <= visible.lastCol; col += 1) {
    const x = config.headerWidth + col * config.colWidth - viewport.scrollX
    ctx.fillStyle =
      normalizedSelection.start.col <= col &&
      normalizedSelection.end.col >= col &&
      normalizedSelection.start.row === 0 &&
      normalizedSelection.end.row === options.rowCount - 1
        ? COLORS.headerSelectedText
        : COLORS.headerText
    ctx.fillText(columnLabel(col), x + config.colWidth / 2, config.headerHeight / 2)
  }

  for (let row = visible.firstRow; row <= visible.lastRow; row += 1) {
    const y = config.headerHeight + row * config.rowHeight - viewport.scrollY
    ctx.fillStyle =
      normalizedSelection.start.row <= row &&
      normalizedSelection.end.row >= row &&
      normalizedSelection.start.col === 0 &&
      normalizedSelection.end.col === options.colCount - 1
        ? COLORS.headerSelectedText
        : COLORS.headerText
    ctx.fillText(String(row + 1), config.headerWidth / 2, y + config.rowHeight / 2)
  }
}

function getCellViewportRect(
  coord: CellCoord,
  viewport: ViewportState,
  config: Required<RenderConfig>
) {
  return {
    x: config.headerWidth + coord.col * config.colWidth - viewport.scrollX,
    y: config.headerHeight + coord.row * config.rowHeight - viewport.scrollY,
    width: config.colWidth,
    height: config.rowHeight,
  }
}

function resolveStyle(cell: Cell | undefined, styles?: Record<string, Style>): Style {
  return {
    ...(cell?.styleId ? styles?.[cell.styleId] : undefined),
    ...cell?.style,
  }
}

function getTextX(
  cellX: number,
  cellWidth: number,
  paddingX: number,
  align: Style['hAlign'] = 'left'
): number {
  if (align === 'center') {
    return cellX + cellWidth / 2
  }
  if (align === 'right') {
    return cellX + cellWidth - paddingX
  }
  return cellX + paddingX
}

function getUnderlineStartX(textX: number, textWidth: number, align: Style['hAlign'] = 'left') {
  if (align === 'center') {
    return textX - textWidth / 2
  }
  if (align === 'right') {
    return textX - textWidth
  }
  return textX
}

function alignPixel(value: number): number {
  return Math.round(value) + 0.5
}
