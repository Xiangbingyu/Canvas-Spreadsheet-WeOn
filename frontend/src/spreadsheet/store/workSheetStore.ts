/**
 * 当前活动工作表 store（本端 Canvas 渲染用）
 *
 * - 只保存「本用户当前正在看」的那张 sheet 的 WorksheetData
 * - 与 workbook.sheets[activeSheetId] 在切换 tab 时应保持一致
 * - 不单独 dispatch 改单元格；改单元格请 dispatch workbook/updateCell，本 slice 自动跟进
 */
//工作表数据管理store

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Cell, WorksheetData } from '@/spreadsheet/model/types'
import { applyUpdateCellToWorksheet } from '@/spreadsheet/utils/applyUpdateCell'
import {
  updateCell as updateWorkbookCell,
  updateRange as updateWorkbookRange,
} from './workbookStore'

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
    /** 整表替换当前活动 sheet（GET 加载、切换 sheet、Excel 导入后激活 sheet） */
    setWorksheet(_state, action: PayloadAction<WorksheetData>) {
      return action.payload
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
  extraReducers(builder) {
    /**
     * 监听 workbook/updateCell：
     * - 远端改的是别的 sheet → 只更新 workbook，本 slice 跳过（用户切 tab 后从 sheets 加载）
     * - 改的是本端当前 sheet → 同步 workSheet，Canvas 立即刷新
     */
    builder.addCase(updateWorkbookCell, function syncActiveWorksheet(state, action) {
      const { sheetId, ...input } = action.payload
      if (sheetId !== state.sheetId) return
      applyUpdateCellToWorksheet(state, input)
    })

    /**
     * 监听 workbook/updateRange：
     * - 远端改的是别的 sheet → 只更新 workbook，本 slice 跳过
     * - 改的是本端当前 sheet → 同步 workSheet，Canvas 立即刷新
     */
    builder.addCase(updateWorkbookRange, function syncActiveWorksheetRange(state, action) {
      const { sheetId, updates } = action.payload
      if (sheetId !== state.sheetId) return
      for (const u of updates) {
        applyUpdateCellToWorksheet(state, u)
      }
    })
  },
})

export const { setWorksheet, insertRow, deleteRow, insertCol, deleteCol } = workSheetSlice.actions
export { updateCell, updateRange } from './workbookStore'
export const workSheetReducer = workSheetSlice.reducer
