// Basic interaction engine helpers for selection, keyboard movement, and edit callbacks.
// Canvas rendering can use these contracts without owning editing state.
// Input: cell and keyboard events; output: selection/edit callback notifications.
import type { CellCoord, RenderConfig, SelectionRange } from '@/spreadsheet/model/types'
import type { InteractionCallbacks, SelectionChangeEventArgs } from './interaction'

export interface InteractionEngineConfig extends Required<RenderConfig> {
  rowCount: number
  colCount: number
}

export function getCellRect(
  coord: CellCoord,
  config: Required<RenderConfig>
): { x: number; y: number; width: number; height: number } {
  return {
    x: config.headerWidth + coord.col * config.colWidth,
    y: config.headerHeight + coord.row * config.rowHeight,
    width: config.colWidth,
    height: config.rowHeight,
  }
}

export function hitTest(
  mouseX: number,
  mouseY: number,
  config: Required<RenderConfig>
): CellCoord | null {
  const relativeX = mouseX - config.headerWidth
  const relativeY = mouseY - config.headerHeight

  if (relativeX < 0 || relativeY < 0) {
    return null
  }

  return {
    row: Math.floor(relativeY / config.rowHeight),
    col: Math.floor(relativeX / config.colWidth),
  }
}

interface InteractionEngineState {
  selection: SelectionRange
  isEditing: boolean
  editingCoord?: CellCoord
  isSelecting: boolean
  selectionStart?: CellCoord
}

export class InteractionEngine {
  private state: InteractionEngineState
  private callbacks: InteractionCallbacks
  private config: InteractionEngineConfig

  constructor(config: InteractionEngineConfig, callbacks: InteractionCallbacks) {
    this.config = config
    this.callbacks = callbacks
    this.state = {
      selection: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      isEditing: false,
      isSelecting: false,
    }
  }

  setCallbacks(callbacks: InteractionCallbacks) {
    this.callbacks = callbacks
  }

  setConfig(config: InteractionEngineConfig) {
    this.config = config
  }

  setSelection(selection: SelectionRange, reason: SelectionChangeEventArgs['reason'] = 'api') {
    this.state.selection = normalizeSelection(selection.start, selection.end)
    this.callbacks.onSelectionChange?.({
      newSelection: this.state.selection,
      reason,
    })
  }

  handleCellClick(coord: CellCoord, event: MouseEvent) {
    this.setSelection({ start: coord, end: coord }, 'mouse')
    this.callbacks.onCellClick?.({ coord, event })
  }

  handleCellDoubleClick(coord: CellCoord, event: MouseEvent) {
    this.state.isEditing = true
    this.state.editingCoord = coord
    this.callbacks.onCellDoubleClick?.({ coord, event })
  }

  handleCellMouseDown(coord: CellCoord, event: MouseEvent) {
    this.state.isSelecting = true
    this.state.selectionStart = coord
    this.callbacks.onCellMouseDown?.({ coord, event })
  }

  handleCellMouseMove(coord: CellCoord, event: MouseEvent) {
    if (this.state.isSelecting && this.state.selectionStart) {
      this.setSelection({ start: this.state.selectionStart, end: coord }, 'mouse')
    }
    this.callbacks.onCellMouseMove?.({ coord, event })
  }

  handleCellMouseUp(coord: CellCoord, event: MouseEvent) {
    this.state.isSelecting = false
    this.state.selectionStart = undefined
    this.callbacks.onCellMouseUp?.({ coord, event })
  }

  handleCanvasClick(event: MouseEvent) {
    this.callbacks.onCanvasClick?.({ event })
  }

  handleKeyboard(event: KeyboardEvent) {
    const selection = this.state.selection
    const coord = { ...selection.end }

    if (event.key === 'ArrowUp') {
      coord.row = Math.max(0, coord.row - 1)
    } else if (event.key === 'ArrowDown') {
      coord.row = Math.min(this.config.rowCount - 1, coord.row + 1)
    } else if (event.key === 'ArrowLeft') {
      coord.col = Math.max(0, coord.col - 1)
    } else if (event.key === 'ArrowRight') {
      coord.col = Math.min(this.config.colCount - 1, coord.col + 1)
    } else {
      this.callbacks.onKeyboard?.({ event, currentSelection: selection })
      return
    }

    const nextSelection = event.shiftKey
      ? { start: selection.start, end: coord }
      : { start: coord, end: coord }

    this.setSelection(nextSelection, 'keyboard')
    event.preventDefault()
  }

  startEdit(coord: CellCoord) {
    this.state.isEditing = true
    this.state.editingCoord = coord
  }

  submitEdit(value: string) {
    if (!this.state.editingCoord) {
      return
    }

    this.callbacks.onCellEditSubmit?.({
      coord: this.state.editingCoord,
      value,
    })
    this.state.isEditing = false
    this.state.editingCoord = undefined
  }

  cancelEdit() {
    if (!this.state.editingCoord) {
      return
    }

    this.callbacks.onCellEditCancel?.({ coord: this.state.editingCoord })
    this.state.isEditing = false
    this.state.editingCoord = undefined
  }

  getSelection(): SelectionRange {
    return this.state.selection
  }

  isEditing(): boolean {
    return this.state.isEditing
  }

  getEditingCoord(): CellCoord | undefined {
    return this.state.editingCoord
  }
}

export function normalizeSelection(start: CellCoord, end: CellCoord): SelectionRange {
  return {
    start: {
      row: Math.min(start.row, end.row),
      col: Math.min(start.col, end.col),
    },
    end: {
      row: Math.max(start.row, end.row),
      col: Math.max(start.col, end.col),
    },
  }
}
