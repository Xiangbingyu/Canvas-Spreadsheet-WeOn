import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { WorksheetData } from '@/spreadsheet/model/types'

//初始化工作表
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
    //设置工作表【使用导入的工作表替换当前工作表】
    setWorksheet(_state, action: PayloadAction<WorksheetData>) {
      return action.payload
    },
  },
})

export const { setWorksheet } = workSheetSlice.actions

export const store = configureStore({
  reducer: {
    workSheet: workSheetSlice.reducer,
  },
})
