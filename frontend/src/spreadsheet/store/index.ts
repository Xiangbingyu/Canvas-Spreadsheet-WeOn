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

export const store = configureStore({
  reducer: {
    workSheet: workSheetReducer,
    selection: selectionReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export { setWorksheet, updateCell, setSelectedCell }
export { workSheetReducer, selectionReducer }

export type { UpdateCellPayload, SelectedCell, SelectionState, SetSelectedCellPayload }
