// Shared interaction contracts between CanvasSpreadsheet and the editing interaction module.
import type { CSSProperties } from 'react'
import type { Cell, CellCoord, RenderConfig, SelectionRange } from '@/spreadsheet/model/types'

export interface CellClickEventArgs {
  coord: CellCoord
  event: MouseEvent
}

export interface CellDoubleClickEventArgs {
  coord: CellCoord
  event: MouseEvent
}

export interface CellMouseDownEventArgs {
  coord: CellCoord
  event: MouseEvent
}

export interface CellMouseMoveEventArgs {
  coord: CellCoord
  event: MouseEvent
}

export interface CellMouseUpEventArgs {
  coord: CellCoord
  event: MouseEvent
}

export interface CanvasClickEventArgs {
  event: MouseEvent
}

export interface CellEditSubmitEventArgs {
  coord: CellCoord
  value: string
}

export interface CellEditCancelEventArgs {
  coord: CellCoord
}

export interface KeyboardEventArgs {
  event: KeyboardEvent
  currentSelection: SelectionRange
}

export interface SelectionChangeEventArgs {
  newSelection: SelectionRange
  reason: 'mouse' | 'keyboard' | 'api'
}

export interface InteractionCallbacks {
  onCellClick?: (args: CellClickEventArgs) => void
  onCellDoubleClick?: (args: CellDoubleClickEventArgs) => void
  onCellMouseDown?: (args: CellMouseDownEventArgs) => void
  onCellMouseMove?: (args: CellMouseMoveEventArgs) => void
  onCellMouseUp?: (args: CellMouseUpEventArgs) => void
  onCanvasClick?: (args: CanvasClickEventArgs) => void
  onCellEditSubmit?: (args: CellEditSubmitEventArgs) => void
  onCellEditCancel?: (args: CellEditCancelEventArgs) => void
  onKeyboard?: (args: KeyboardEventArgs) => void
  onSelectionChange?: (args: SelectionChangeEventArgs) => void
}

export interface CanvasSpreadsheetProps {
  rowCount: number
  colCount: number
  cells: Record<string, Cell>
  selection: SelectionRange
  editingCell?: CellCoord | null
  config?: RenderConfig
  callbacks: InteractionCallbacks
  className?: string
  style?: CSSProperties
}
