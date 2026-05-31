import { configureStore } from '@reduxjs/toolkit'

import {
  selectionReducer,
  setSelectedCell,
  type SelectedCell,
  type SelectionState,
  type SetSelectedCellPayload,
} from './selectStore'
import {
  setWorksheet,
  updateCell,
  workSheetReducer,
  type UpdateCellPayload,
} from './workSheetStore'
import { collabReducer, setOnlineUsers, setCurrentSeq, setConnectionStatus } from './userStore'
import {
  addSheet,
  initFromDoc,
  setDocTitle,
  switchSheet,
  syncActiveSheetCache,
  workbookReducer,
} from './workbookStore'

export const store = configureStore({
  reducer: {
    workSheet: workSheetReducer,
    workbook: workbookReducer,
    selection: selectionReducer,
    collab: collabReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export {
  setWorksheet,
  updateCell,
  setSelectedCell,
  setOnlineUsers,
  setCurrentSeq,
  setConnectionStatus,
  initFromDoc,
  setDocTitle,
  syncActiveSheetCache,
  switchSheet,
  addSheet,
}
export { workSheetReducer, workbookReducer, selectionReducer, collabReducer }

export type { UpdateCellPayload, SelectedCell, SelectionState, SetSelectedCellPayload }
