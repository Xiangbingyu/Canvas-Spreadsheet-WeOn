//工作表数据管理store

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Cell, Style, WorksheetData } from '@/spreadsheet/model/types'
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'

/** 单个单元格更新：值与样式一并提交 */
export type UpdateCellPayload = {
  row: number
  col: number
  value: string
  /** 修改后的完整样式；不传则保留原 styleId */
  style?: Style
}

// 初始化工作表（name 为文档标题）
const initialWorksheet: WorksheetData = {
  id: '01',
  name: '未命名表格',
  defaultRowHeight: 25,
  defaultColWidth: 100,
  rowCount: 1000,
  colCount: 1000,
  styles: {},
  cells: {},
}

const workSheetSlice = createSlice({
  name: 'workSheet',
  initialState: initialWorksheet,
  reducers: {
    /** 导入 Excel 或整表替换 */
    setWorksheet(_state, action: PayloadAction<WorksheetData>) {
      return action.payload
    },

    /**
     * 更新单个单元格的值与样式
     * Payload: { row: number; col: number; value: string; style?: Style } 修改的【行号、列号、新值、新样式】
     */
    updateCell(state, action: PayloadAction<UpdateCellPayload>) {
      const { row, col, value, style } = action.payload
      const key = `${row}:${col}`
      //边界校验：行号、列号不能小于1，不能大于行数、列数
      if (row < 1 || col < 1 || row > state.rowCount || col > state.colCount) {
        return
      }

      //获取当前单元格数据
      const prev = state.cells[key]

      //如果值为空，则删除该单元格
      if (value === '') {
        delete state.cells[key]
        return
      }
      //
      let styleId: string | undefined
      //如果样式不为空，则在styles中查找或新增，并绑定styleId
      if (style !== undefined) {
        styleId = findOrCreateStyleId(state.styles, style)
      } else {
        //如果样式为空，则保留原styleId
        styleId = prev?.styleId
      }

      //创建新的单元格数据
      const nextCell: Cell = { row, col, value }
      //如果styleId不为空，则绑定styleId
      if (styleId !== undefined) {
        nextCell.styleId = styleId
      }
      //更新单元格数据
      state.cells[key] = nextCell
    },
  },
})

export const { setWorksheet, updateCell } = workSheetSlice.actions
export const workSheetReducer = workSheetSlice.reducer
