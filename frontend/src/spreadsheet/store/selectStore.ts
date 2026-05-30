// 选中区域 store（active cell + 矩形范围）

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { SelectionRange } from '@/spreadsheet/model/selection'
import type { Style } from '@/spreadsheet/model/types'
import { colNumberToLetters } from '@/spreadsheet/utils/coordinates'

/** 当前选中的单元格信息（active cell — 范围的锚点格） */
export type SelectedCell = {
  row: number
  col: number
  address: string
  value: string
  style: Style
  /** 当前选中的矩形范围；单选时 start === end */
  range: SelectionRange
}

export type SelectionState = SelectedCell

/** 鼠标选中时由 Operation 层传入 */
export type SetSelectedCellPayload = {
  row: number
  col: number
  value: string
  style?: Style
  /** 矩形范围；不传则默认为单格 */
  range?: SelectionRange
}

const initialState: SelectedCell = {
  row: 1,
  col: 1,
  address: 'A1',
  value: '',
  style: {},
  range: { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } },
}

const selectSlice = createSlice({
  name: 'selection',
  initialState,
  reducers: {
    /**
     * 鼠标选中单元格，更新行列号 / 地址 / 值 / 样式 / 范围
     * address 由 row、col 自动生成（如 A1、BC23）
     */
    setSelectedCell(state, action: PayloadAction<SetSelectedCellPayload>) {
      const { row, col, value, style, range } = action.payload
      state.row = row
      state.col = col
      state.address = `${colNumberToLetters(col)}${row}`
      state.value = value
      state.style = style ?? {}
      state.range = range ?? { start: { row, col }, end: { row, col } }
    },
  },
})

export const { setSelectedCell } = selectSlice.actions
export const selectionReducer = selectSlice.reducer
