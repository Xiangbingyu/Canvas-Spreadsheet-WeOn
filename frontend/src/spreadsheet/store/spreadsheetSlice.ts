// Redux slice for worksheet data, selection, editing marker, and viewport state.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import {
  cellKey,
  coordToAddress,
  type Cell,
  type CellCoord,
  type SelectionRange,
  type Style,
  type ViewportState,
  type WorksheetInput,
} from '@/spreadsheet/model/types'
import { normalizeRange } from '@/spreadsheet/utils/range'
import { normalizeWorksheetInput } from '@/spreadsheet/utils/worksheetAdapter'

export interface SpreadsheetState {
  rowCount: number
  colCount: number
  cells: Record<string, Cell>
  styles: Record<string, Style>
  selection: SelectionRange
  editingCell: CellCoord | null
  viewport: ViewportState
}

const initialState: SpreadsheetState = {
  rowCount: 200,
  colCount: 60,
  cells: {
    '0:0': { row: 0, col: 0, value: 'Imported data renders here', styleId: 's_header' },
    '1:0': { row: 1, col: 0, value: 'Canvas 2D', styleId: 's_accent' },
    '1:1': { row: 1, col: 1, value: 'Virtual scroll' },
    '1:2': { row: 1, col: 2, value: 'Selection callbacks' },
    '3:2': { row: 3, col: 2, value: 'Right aligned', styleId: 's_right' },
    '4:3': { row: 4, col: 3, value: 'Long text is clipped inside the cell boundary' },
  },
  styles: {
    s_header: {
      bold: true,
      color: '#ffffff',
      bgColor: '#188038',
      hAlign: 'center',
    },
    s_accent: {
      bold: true,
      color: '#174ea6',
      bgColor: '#e8f0fe',
    },
    s_right: {
      hAlign: 'right',
      color: '#5f6368',
    },
  },
  selection: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
  editingCell: null,
  viewport: { scrollX: 0, scrollY: 0, width: 0, height: 0 },
}

const spreadsheetSlice = createSlice({
  name: 'spreadsheet',
  initialState,
  reducers: {
    loadWorksheet(state, action: PayloadAction<WorksheetInput>) {
      const snapshot = normalizeWorksheetInput(action.payload)

      state.rowCount = snapshot.rowCount
      state.colCount = snapshot.colCount
      state.cells = snapshot.cells
      state.styles = snapshot.styles ?? {}
      state.selection = { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }
      state.editingCell = null
      state.viewport = { scrollX: 0, scrollY: 0, width: 0, height: 0 }
    },
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

export const { loadWorksheet, setActiveCell, setEditingCell, setSelection, setViewport } =
  spreadsheetSlice.actions

export const spreadsheetReducer = spreadsheetSlice.reducer

export const selectSpreadsheet = (state: { spreadsheet: SpreadsheetState }) => state.spreadsheet

export const selectActiveCellAddress = (state: { spreadsheet: SpreadsheetState }) =>
  coordToAddress(state.spreadsheet.selection.start)

export const selectActiveCellValue = (state: { spreadsheet: SpreadsheetState }) => {
  const key = cellKey(state.spreadsheet.selection.start)
  return state.spreadsheet.cells[key]?.value ?? ''
}
