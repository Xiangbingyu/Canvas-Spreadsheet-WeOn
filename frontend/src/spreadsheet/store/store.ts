// Redux store setup and typed hooks for spreadsheet feature state.
import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux'
import { spreadsheetReducer } from './spreadsheetSlice'

export const store = configureStore({
  reducer: {
    spreadsheet: spreadsheetReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
