// Redux slice for Canvas UI state such as selection, editing marker, and viewport.
// Input: UI actions and workSheet data for selectors; output: Canvas UI state/selectors.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import {
  cellKey,
  coordToAddress,
  type CellCoord,
  type SelectionRange,
  type ViewportState,
} from '@/spreadsheet/model/types'
import { normalizeRange } from '@/spreadsheet/utils/range'
import type { WorksheetData } from '@/spreadsheet/model/types'

export interface SpreadsheetState {
  selection: SelectionRange
  editingCell: CellCoord | null
  viewport: ViewportState
}

const initialState: SpreadsheetState = {
  selection: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
  editingCell: null,
  viewport: { scrollX: 0, scrollY: 0, width: 0, height: 0 },
}

const spreadsheetSlice = createSlice({
  name: 'spreadsheet',
  initialState,
  reducers: {
    setSelection(state, action: PayloadAction<SelectionRange>) {
      state.selection = normalizeRange(action.payload)
    },
    setActiveCell(state, action: PayloadAction<CellCoord>) {
      state.selection = { start: action.payload, end: action.payload }
    },
    setEditingCell(state, action: PayloadAction<CellCoord | null>) {
      state.editingCell = action.payload
    },
    setViewport(state, action: PayloadAction<ViewportState>) {
      state.viewport = action.payload
    },
  },
})

export const { setActiveCell, setEditingCell, setSelection, setViewport } = spreadsheetSlice.actions

export const spreadsheetReducer = spreadsheetSlice.reducer

export const selectSpreadsheet = (state: { spreadsheet: SpreadsheetState }) => state.spreadsheet

export const selectActiveCellAddress = (state: { spreadsheet: SpreadsheetState }) =>
  coordToAddress(state.spreadsheet.selection.start)

export const selectActiveCellValue = (state: {
  spreadsheet: SpreadsheetState
  workSheet: WorksheetData
}) => {
  const activeCell = state.spreadsheet.selection.start
  const key = cellKey({ row: activeCell.row + 1, col: activeCell.col + 1 })

  return state.workSheet.cells[key]?.value ?? ''
}
