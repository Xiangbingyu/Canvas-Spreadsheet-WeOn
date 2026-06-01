import { configureStore } from '@reduxjs/toolkit'

import {
  selectionReducer,
  setSelectedCell,
  type SelectedCell,
  type SelectionState,
  type SetSelectedCellPayload,
} from './selectStore'
import { setWorksheet, workSheetReducer } from './workSheetStore'
import type { UpdateCellPayload } from '@/spreadsheet/utils/applyUpdateCell'

import {
  collabReducer,
  setDocTitle,
  setOnlineUsers,
  setCurrentSeq,
  setConnectionStatus,
} from './userStore'
import {
  addSheet,
  initFromDoc,
  switchSheet,
  importWorkbook,
  updateCell,
  workbookReducer,
} from './workbookStore'
import { clipboardReducer, setClipboard, clearClipboard } from './clipboardStore'

export const store = configureStore({
  reducer: {
    workSheet: workSheetReducer,
    workbook: workbookReducer,
    selection: selectionReducer,
    collab: collabReducer,
    clipboard: clipboardReducer,
  },
  // 大表 cells 较多时，开发态 immutable/serializable 检查会明显拖慢 dispatch
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: false,
    }),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export {
  setWorksheet,
  updateCell,
  setSelectedCell,
  setDocTitle,
  setOnlineUsers,
  setCurrentSeq,
  setConnectionStatus,
  initFromDoc,
  switchSheet,
  addSheet,
  importWorkbook,
  setClipboard,
  clearClipboard,
}
export { workSheetReducer, workbookReducer, selectionReducer, collabReducer, clipboardReducer }

export type { UpdateCellPayload, SelectedCell, SelectionState, SetSelectedCellPayload }
