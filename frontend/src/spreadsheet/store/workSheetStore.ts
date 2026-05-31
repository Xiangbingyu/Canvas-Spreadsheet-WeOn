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

// 初始化工作表
const initialWorksheet: WorksheetData = {
  sheetId: '01',
  sheetName: 'Sheet1',
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
      //如果值为空且样式为空，则删除该单元格
      if (value === '' && style === undefined) {
        delete state.cells[key]
        return
      }

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

    /** 在指定行前插入一行 */
    insertRow(state, action: PayloadAction<{ row: number }>) {
      const { row } = action.payload
      if (row < 1 || row > state.rowCount + 1) return

      // 重新映射单元格坐标：row 及以后的行号 +1
      const newCells: Record<string, Cell> = {}
      for (const [key, cell] of Object.entries(state.cells)) {
        if (cell.row >= row) {
          const newKey = `${cell.row + 1}:${cell.col}`
          newCells[newKey] = { ...cell, row: cell.row + 1 }
        } else {
          newCells[key] = cell
        }
      }
      state.cells = newCells
      state.rowCount += 1
    },

    /** 删除指定行 */
    deleteRow(state, action: PayloadAction<{ row: number }>) {
      const { row } = action.payload
      if (row < 1 || row > state.rowCount) return

      // 删除该行的所有单元格，后续行号 -1
      const newCells: Record<string, Cell> = {}
      for (const [key, cell] of Object.entries(state.cells)) {
        if (cell.row === row) {
          // 删除该行
          continue
        } else if (cell.row > row) {
          const newKey = `${cell.row - 1}:${cell.col}`
          newCells[newKey] = { ...cell, row: cell.row - 1 }
        } else {
          newCells[key] = cell
        }
      }
      state.cells = newCells
      state.rowCount -= 1
    },

    /** 在指定列前插入一列 */
    insertCol(state, action: PayloadAction<{ col: number }>) {
      const { col } = action.payload
      if (col < 1 || col > state.colCount + 1) return

      // 重新映射单元格坐标：col 及以后的列号 +1
      const newCells: Record<string, Cell> = {}
      for (const [key, cell] of Object.entries(state.cells)) {
        if (cell.col >= col) {
          const newKey = `${cell.row}:${cell.col + 1}`
          newCells[newKey] = { ...cell, col: cell.col + 1 }
        } else {
          newCells[key] = cell
        }
      }
      state.cells = newCells
      state.colCount += 1
    },

    /** 删除指定列 */
    deleteCol(state, action: PayloadAction<{ col: number }>) {
      const { col } = action.payload
      if (col < 1 || col > state.colCount) return

      // 删除该列的所有单元格，后续列号 -1
      const newCells: Record<string, Cell> = {}
      for (const [key, cell] of Object.entries(state.cells)) {
        if (cell.col === col) {
          // 删除该列
          continue
        } else if (cell.col > col) {
          const newKey = `${cell.row}:${cell.col - 1}`
          newCells[newKey] = { ...cell, col: cell.col - 1 }
        } else {
          newCells[key] = cell
        }
      }
      state.cells = newCells
      state.colCount -= 1
    },
  },
})

export const { setWorksheet, updateCell, insertRow, deleteRow, insertCol, deleteCol } =
  workSheetSlice.actions
export const workSheetReducer = workSheetSlice.reducer
