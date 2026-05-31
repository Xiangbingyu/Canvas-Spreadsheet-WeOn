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
import {
  collabReducer,
  setDocTitle,
  setOnlineUsers,
  setUserCursor,
  removeUserCursor,
  setCurrentSeq,
  setConnectionStatus,
} from './userStore'
import {
  addSheet,
  initFromDoc,
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
  setUserCursor,
  removeUserCursor,
  setCurrentSeq,
  setConnectionStatus,
  initFromDoc,
  syncActiveSheetCache,
  switchSheet,
  addSheet,
}
export { workSheetReducer, workbookReducer, selectionReducer, collabReducer }

export type { UpdateCellPayload, SelectedCell, SelectionState, SetSelectedCellPayload }
