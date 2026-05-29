// 选中区域 store（当前：单个单元格；后续可扩展区域选中）

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Style } from '@/spreadsheet/model/types'
import { colNumberToLetters } from '@/spreadsheet/utils/coordinates'

/** 当前选中的单元格信息 */
export type SelectedCell = {
  row: number
  col: number
  address: string
  value: string
  style: Style
}

export type SelectionState = SelectedCell

/** 鼠标选中时由 Operation 层传入 */
export type SetSelectedCellPayload = {
  row: number
  col: number
  value: string
  style?: Style
}

const initialState: SelectedCell = {
  row: 1,
  col: 1,
  address: 'A1',
  value: '',
  style: {},
}

const selectSlice = createSlice({
  name: 'selection',
  initialState,
  reducers: {
    /**
     * 鼠标选中单元格，更新行列号 / 地址 / 值 / 样式
     * address 由 row、col 自动生成（如 A1、BC23）
     */
    setSelectedCell(state, action: PayloadAction<SetSelectedCellPayload>) {
      const { row, col, value, style } = action.payload
      state.row = row
      state.col = col
      state.address = `${colNumberToLetters(col)}${row}`
      state.value = value
      state.style = style ?? {}
    },
  },
})

export const { setSelectedCell } = selectSlice.actions
export const selectionReducer = selectSlice.reducer
