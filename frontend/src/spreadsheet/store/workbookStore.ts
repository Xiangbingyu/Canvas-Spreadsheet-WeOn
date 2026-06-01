/**
 * 工作簿 store（文档级真源）
 *
 * - sheets[sheetId]：整张工作簿里所有 sheet 的数据（协作写入都落这里）
 * - activeSheetId：本客户端当前激活的 sheet（各用户/tab 可不同，仅本地 UI 状态）
 *
 * 单元格变更入口：updateCell({ sheetId, row, col, value, style? })
 * 对应 WS set_cell / cell_updated / undo_applied / redo_applied
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { WorksheetData } from '@/spreadsheet/model/types'
import { createEmptySheet, generateNextSheetId } from '@/spreadsheet/utils/createEmptySheet'
import {
  applyUpdateCellToWorksheet,
  type UpdateCellPayload,
} from '@/spreadsheet/utils/applyUpdateCell'

export interface WorkbookState {
  docTitle: string
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
}

const initialState: WorkbookState = {
  docTitle: '',
  activeSheetId: '',
  sheetOrder: [],
  sheets: {},
}

/** GET /docs/:docId 加载后写入 workbook（sheets 已由 HTTP 层规范化） */
export type WorkbookSnapshotPayload = {
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
}

type InitFromDocPayload = {
  docTitle: string
} & WorkbookSnapshotPayload

type SwitchSheetPayload = {
  savedSheet: WorksheetData
  targetSheetId: string
}

type AddSheetPayload = {
  savedSheet: WorksheetData
  sheetName: string
}

export type UpdateRangePayload = {
  sheetId: string
  updates: Array<{ row: number; col: number; value: string; style?: Style | null }>
}

const workbookSlice = createSlice({
  name: 'workbook',
  initialState,
  reducers: {
    /** GET /docs/:docId 加载：workbook 快照 → 工作簿 */
    initFromDoc(state, action: PayloadAction<InitFromDocPayload>) {
      const { docTitle, activeSheetId, sheetOrder, sheets } = action.payload
      state.docTitle = docTitle
      state.activeSheetId = activeSheetId
      state.sheetOrder = sheetOrder
      state.sheets = sheets
    },

    setDocTitle(state, action: PayloadAction<string>) {
      state.docTitle = action.payload
    },

    /**
     * 切换工作表
     * Payload: { savedSheet: 当前活动 sheet; targetSheetId: 目标 sheetId }
     */
    switchSheet(state, action: PayloadAction<SwitchSheetPayload>) {
      const { savedSheet, targetSheetId } = action.payload
      if (!state.sheets[targetSheetId]) return
      state.sheets[state.activeSheetId] = savedSheet
      state.activeSheetId = targetSheetId
    },

    /**
     * 新增工作表（对应 WS add_sheet；行列从 1 开始）
     * Payload: { savedSheet: 当前活动 sheet; sheetName: 新表名 }
     */
    addSheet(state, action: PayloadAction<AddSheetPayload>) {
      const { savedSheet, sheetName } = action.payload
      const trimmed = sheetName.trim()
      if (!trimmed) return

      state.sheets[state.activeSheetId] = savedSheet
      const sheetId = generateNextSheetId(state.sheetOrder)
      const newSheet = createEmptySheet(sheetId, trimmed)
      state.sheets[sheetId] = newSheet
      state.sheetOrder.push(sheetId)
      state.activeSheetId = sheetId
    },

    /** Excel 导入 / 整表替换：写入 workbook 快照，默认激活第一个 sheet  因为没有接后端，暂时使用 */
    importWorkbook(state, action: PayloadAction<WorkbookSnapshotPayload>) {
      const { activeSheetId, sheetOrder, sheets } = action.payload
      if (sheetOrder.length === 0 || Object.keys(sheets).length === 0) return

      const resolvedActive =
        typeof activeSheetId === 'string' && sheets[activeSheetId]
          ? activeSheetId
          : (sheetOrder.find((id) => sheets[id]) ?? sheetOrder[0])

      state.sheetOrder = sheetOrder.filter((id) => sheets[id])
      state.sheets = sheets
      state.activeSheetId = resolvedActive
    },

    /**
     * 按 sheetId 更新工作簿内指定单元格（协作本地落库唯一入口）
     *
     * - 始终写入 state.sheets[sheetId]（无论是否当前激活表）
     * - 若改的是本端正在看的表，workSheetStore 会通过 extraReducer 同步，Canvas 才会重绘
     *
     * 协作模块收到广播后只需：dispatch(updateCell({ sheetId, row, col, value, style }))
     */
    updateCell(state, action: PayloadAction<UpdateCellPayload>) {
      const { sheetId } = action.payload
      const sheet = state.sheets[sheetId]
      if (!sheet) return
      applyUpdateCellToWorksheet(sheet, action.payload)
    },

    /**
     * 批量更新工作簿内指定范围的单元格（原子操作）
     *
     * - 始终写入 state.sheets[sheetId]（无论是否当前激活表）
     * - 若改的是本端正在看的表，workSheetStore 会通过 extraReducer 同步，Canvas 才会重绘
     *
     * 协作模块收到广播后只需：dispatch(updateRange({ sheetId, updates }))
     */
    updateRange(state, action: PayloadAction<UpdateRangePayload>) {
      const { sheetId, updates } = action.payload
      const sheet = state.sheets[sheetId]
      if (!sheet) return
      for (const u of updates) {
        applyUpdateCellToWorksheet(sheet, { sheetId, ...u })
      }
    },
  },
})

export const {
  initFromDoc,
  setDocTitle,
  switchSheet,
  addSheet,
  importWorkbook,
  updateCell,
  updateRange,
} = workbookSlice.actions
export const workbookReducer = workbookSlice.reducer
