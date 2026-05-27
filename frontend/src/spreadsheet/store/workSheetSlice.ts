// Redux slice for imported worksheet data owned by the Excel integration path.
// Canvas reads this slice but keeps rendering state in spreadsheetSlice.
// Input: WorksheetData from Excel parsing; output: workSheet state and selector.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { WorksheetData } from '@/spreadsheet/model/types'

const initialWorksheet: WorksheetData = {
  id: '01',
  name: 'Sheet1',
  defaultRowHeight: 25,
  defaultColWidth: 100,
  styles: {},
  cells: {},
}

const workSheetSlice = createSlice({
  name: 'workSheet',
  initialState: initialWorksheet,
  reducers: {
    setWorksheet(_state, action: PayloadAction<WorksheetData>) {
      return action.payload
    },
  },
})

export const { setWorksheet } = workSheetSlice.actions

export const workSheetReducer = workSheetSlice.reducer

export const selectWorksheet = (state: { workSheet: WorksheetData }) => state.workSheet
