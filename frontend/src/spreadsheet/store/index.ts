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

export const store = configureStore({
  reducer: {
    workSheet: workSheetReducer,
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
}
export { workSheetReducer, selectionReducer, collabReducer }

export type { UpdateCellPayload, SelectedCell, SelectionState, SetSelectedCellPayload }
