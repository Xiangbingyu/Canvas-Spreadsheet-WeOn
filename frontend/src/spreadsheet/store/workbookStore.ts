import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { WorksheetData } from '@/spreadsheet/model/types'
import { createEmptySheet, generateNextSheetId } from '@/spreadsheet/utils/createEmptySheet'

export interface WorkbookState {
  docTitle: string
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
}

const initialState: WorkbookState = {
  docTitle: '',
  activeSheetId: '',
  sheetOrder: [],
  sheets: {},
}

type InitFromDocPayload = {
  docTitle: string
  worksheet: WorksheetData
}

type SwitchSheetPayload = {
  savedSheet: WorksheetData
  targetSheetId: string
}

type AddSheetPayload = {
  savedSheet: WorksheetData
  sheetName: string
}

const workbookSlice = createSlice({
  name: 'workbook',
  initialState,
  reducers: {
    /** GET /docs 或新建文档后：单 sheet 快照 → 工作簿 */
    initFromDoc(state, action: PayloadAction<InitFromDocPayload>) {
      const { docTitle, worksheet } = action.payload
      state.docTitle = docTitle
      state.activeSheetId = worksheet.sheetId
      state.sheetOrder = [worksheet.sheetId]
      state.sheets = { [worksheet.sheetId]: worksheet }
    },

    setDocTitle(state, action: PayloadAction<string>) {
      state.docTitle = action.payload
    },

    /** 协作 snapshot / 导入：刷新当前活动 sheet 缓存 */
    syncActiveSheetCache(state, action: PayloadAction<WorksheetData>) {
      if (!state.activeSheetId) return
      state.sheets[state.activeSheetId] = action.payload
    },

    switchSheet(state, action: PayloadAction<SwitchSheetPayload>) {
      const { savedSheet, targetSheetId } = action.payload
      if (!state.sheets[targetSheetId]) return
      state.sheets[state.activeSheetId] = savedSheet
      state.activeSheetId = targetSheetId
    },

    addSheet(state, action: PayloadAction<AddSheetPayload>) {
      const { savedSheet, sheetName } = action.payload
      const trimmed = sheetName.trim()
      if (!trimmed) return

      state.sheets[state.activeSheetId] = savedSheet
      const sheetId = generateNextSheetId(state.sheetOrder)
      const newSheet = createEmptySheet(sheetId, trimmed)
      state.sheets[sheetId] = newSheet
      state.sheetOrder.push(sheetId)
      state.activeSheetId = sheetId
    },
  },
})

export const { initFromDoc, setDocTitle, syncActiveSheetCache, switchSheet, addSheet } =
  workbookSlice.actions
export const workbookReducer = workbookSlice.reducer
