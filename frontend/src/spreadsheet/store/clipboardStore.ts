// 剪贴板状态管理

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Style } from '@/spreadsheet/model/types'

/** 剪贴板中的单个单元格数据 */
export interface ClipboardCell {
  value: string
  style?: Style
}

/** 剪贴板状态 */
export interface ClipboardState {
  cells: Record<string, ClipboardCell> // key: "row:col"
  range?: {
    startRow: number
    startCol: number
    endRow: number
    endCol: number
  }
}

const initialState: ClipboardState = {
  cells: {},
}

const clipboardSlice = createSlice({
  name: 'clipboard',
  initialState,
  reducers: {
    /**
     * 设置剪贴板数据
     * cells: 单元格数据映射 (key: "row:col")
     * range: 原始选区范围（用于粘贴时计算偏移）
     */
    setClipboard(
      state,
      action: PayloadAction<{
        cells: Record<string, ClipboardCell>
        range?: { startRow: number; startCol: number; endRow: number; endCol: number }
      }>
    ) {
      state.cells = action.payload.cells
      state.range = action.payload.range
    },

    /** 清空剪贴板 */
    clearClipboard(state) {
      state.cells = {}
      state.range = undefined
    },
  },
})

export const { setClipboard, clearClipboard } = clipboardSlice.actions
export const clipboardReducer = clipboardSlice.reducer
