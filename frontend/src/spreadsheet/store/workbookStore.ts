/**
 * 工作簿 store（文档级真源）
 *
 * - state 形状见 model/types WorkbookData
 * - workSheetStore 只镜像当前激活的一张 WorksheetData；改格请 dispatch 本 slice 的 updateCell / updateRange
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Style, WorkbookData, WorksheetData } from '@/spreadsheet/model/types'
import { createEmptySheet, generateNextSheetId } from '@/spreadsheet/utils/createEmptySheet'
import { applyUpdateCellToWorksheet } from '@/spreadsheet/utils/applyUpdateCell'

const initialState: WorkbookData = {
  docTitle: '',
  activeSheetId: '',
  sheetOrder: [],
  sheets: {},
}

const workbookSlice = createSlice({
  name: 'workbook',
  initialState,
  reducers: {
    initFromDoc(state, action: PayloadAction<WorkbookData>) {
      const { docTitle, activeSheetId, sheetOrder, sheets } = action.payload
      state.docTitle = docTitle
      state.activeSheetId = activeSheetId
      state.sheetOrder = sheetOrder
      state.sheets = sheets
    },

    setDocTitle(state, action: PayloadAction<string>) {
      state.docTitle = action.payload
    },

    switchSheet(
      state,
      action: PayloadAction<{ savedSheet: WorksheetData; targetSheetId: string }>
    ) {
      const { savedSheet, targetSheetId } = action.payload
      if (!state.sheets[targetSheetId]) return
      state.sheets[state.activeSheetId] = savedSheet
      state.activeSheetId = targetSheetId
    },

    addSheet(state, action: PayloadAction<{ savedSheet: WorksheetData; sheetName: string }>) {
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

    applySheetAdded(
      state,
      action: PayloadAction<{
        sheetOrder: string[]
        sheet: WorksheetData
        replaceSheetId?: string
      }>
    ) {
      const { sheetOrder, sheet, replaceSheetId: explicitReplace } = action.payload

      let replaceSheetId = explicitReplace
      if (!replaceSheetId) {
        for (const id of state.sheetOrder) {
          const local = state.sheets[id]
          if (
            id.startsWith('local_') &&
            local?.sheetName === sheet.sheetName &&
            !sheetOrder.includes(id)
          ) {
            replaceSheetId = id
            break
          }
        }
      }

      if (replaceSheetId && replaceSheetId !== sheet.sheetId) {
        if (state.activeSheetId === replaceSheetId) {
          state.activeSheetId = sheet.sheetId
        }
        delete state.sheets[replaceSheetId]
      }

      state.sheets[sheet.sheetId] = sheet
      state.sheetOrder = sheetOrder

      for (const id of Object.keys(state.sheets)) {
        if (!sheetOrder.includes(id)) {
          delete state.sheets[id]
        }
      }
    },

    importWorkbook(
      state,
      action: PayloadAction<{
        activeSheetId: string
        sheetOrder: string[]
        sheets: Record<string, WorksheetData>
      }>
    ) {
      const { activeSheetId, sheetOrder, sheets } = action.payload
      if (sheetOrder.length === 0 || Object.keys(sheets).length === 0) return

      const resolvedActive =
        typeof activeSheetId === 'string' && sheets[activeSheetId]
          ? activeSheetId
          : (sheetOrder.find((id) => sheets[id]) ?? sheetOrder[0])

      state.sheetOrder = sheetOrder.filter((id) => sheets[id])
      state.sheets = sheets
      state.activeSheetId = resolvedActive
    },

    updateCell(
      state,
      action: PayloadAction<{
        sheetId: string
        row: number
        col: number
        value: string
        style?: Style | null
      }>
    ) {
      const { sheetId, ...input } = action.payload
      const sheet = state.sheets[sheetId]
      if (!sheet) return
      applyUpdateCellToWorksheet(sheet, input)
    },

    updateRange(
      state,
      action: PayloadAction<{
        sheetId: string
        updates: Array<{
          row: number
          col: number
          value: string
          style?: Style | null
        }>
      }>
    ) {
      const { sheetId, updates } = action.payload
      const sheet = state.sheets[sheetId]
      if (!sheet) return
      for (const u of updates) {
        applyUpdateCellToWorksheet(sheet, u)
      }
    },
  },
})

export const {
  initFromDoc,
  setDocTitle,
  switchSheet,
  addSheet,
  applySheetAdded,
  importWorkbook,
  updateCell,
  updateRange,
} = workbookSlice.actions
export const workbookReducer = workbookSlice.reducer
