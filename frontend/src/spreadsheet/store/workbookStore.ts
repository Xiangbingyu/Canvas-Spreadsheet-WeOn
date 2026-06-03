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
import type { Style, WorksheetData } from '@/spreadsheet/model/types'
import { createEmptySheet, generateNextSheetId } from '@/spreadsheet/utils/createEmptySheet'
import {
  applyUpdateCellToWorksheet,
  type ApplyUpdateCellInput,
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

/** 服务端 sheet_added 确认：合并新表并替换同名乐观 local_* id */
export type ApplySheetAddedPayload = {
  sheetOrder: string[]
  sheet: WorksheetData
  replaceSheetId?: string
}

export type UpdateRangePayload = {
  sheetId: string
  updates: ApplyUpdateCellInput[]
}

/**
 * set_range_values 的单元格项（协议形态）：逐格不同的 value/style。
 * - value 缺省：保留该格原值
 * - styleId 缺省：保留该格原样式；显式 null：清空样式
 */
export type RangeValueCell = {
  row: number
  col: number
  value?: string
  styleId?: string | null
}

/**
 * set_range_values 的 payload（与 WS 协议提案对齐，见 plan/SetRangeValues_协议提案_lxl.md）。
 * 样式池化：相同样式只存一份在 styles 池，cells 用 styleId 引用，承载超大数据写入。
 */
export type SetRangeValuesPayload = {
  sheetId: string
  styles?: Record<string, Style>
  cells: RangeValueCell[]
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

    /** WS sheet_added：校正乐观 id 或合并远端新建表（不切换当前 tab） */
    applySheetAdded(state, action: PayloadAction<ApplySheetAddedPayload>) {
      const { sheetOrder, sheet, replaceSheetId: explicitReplace } = action.payload

      let replaceSheetId = explicitReplace
      if (!replaceSheetId) {
        for (const id of state.sheetOrder) {
          const local = state.sheets[id]
          if (
            id.startsWith('local_') &&
            local?.sheetName === sheet.sheetName &&
            !sheetOrder.includes(id)
          ) {
            replaceSheetId = id
            break
          }
        }
      }

      if (replaceSheetId && replaceSheetId !== sheet.sheetId) {
        if (state.activeSheetId === replaceSheetId) {
          state.activeSheetId = sheet.sheetId
        }
        delete state.sheets[replaceSheetId]
      }

      state.sheets[sheet.sheetId] = sheet
      state.sheetOrder = sheetOrder

      for (const id of Object.keys(state.sheets)) {
        if (!sheetOrder.includes(id)) {
          delete state.sheets[id]
        }
      }
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
      const { sheetId, ...input } = action.payload
      const sheet = state.sheets[sheetId]
      if (!sheet) return
      applyUpdateCellToWorksheet(sheet, input)
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
        applyUpdateCellToWorksheet(sheet, u)
      }
    },

    /**
     * 逐格不同的原子批量写入（对应 WS set_range_values / range_values_updated）
     *
     * 与 updateRange 的区别：updateRange 各 update 内联 Style；本接口用样式池化
     * （styles 池 + cells 引用 styleId），承载粘贴 / 混排撤回等超大数据写入。
     * reducer 内把 styleId 解引用为 Style 后复用 applyUpdateCellToWorksheet：
     * - styleId 缺省 → style 传 undefined（保留原样式）
     * - styleId 为 null → style 传 null（清空样式）
     * - styleId 命中池 → style 传对应 Style 对象
     * - value 缺省 → 用该格原值（保留内容）
     *
     * 协作模块收到广播后只需：dispatch(setRangeValues({ sheetId, styles, cells }))
     */
    setRangeValues(state, action: PayloadAction<SetRangeValuesPayload>) {
      const { sheetId, styles, cells } = action.payload
      const sheet = state.sheets[sheetId]
      if (!sheet) return

      for (const cell of cells) {
        const { row, col, value, styleId } = cell

        let style: Style | null | undefined
        if (styleId === null) {
          style = null // 显式清空样式
        } else if (styleId !== undefined) {
          style = styles?.[styleId] // 引用样式池；池中缺失则为 undefined（保留原样式）
        } else {
          style = undefined // 不改样式
        }

        // value 缺省时保留该格原值
        const prev = sheet.cells[`${row}:${col}`]
        const nextValue = value !== undefined ? value : (prev?.value ?? '')

        applyUpdateCellToWorksheet(sheet, { row, col, value: nextValue, style })
      }
    },
  },
})

export const {
  initFromDoc,
  setDocTitle,
  switchSheet,
  addSheet,
  applySheetAdded,
  importWorkbook,
  updateCell,
  updateRange,
  setRangeValues,
} = workbookSlice.actions
export const workbookReducer = workbookSlice.reducer
