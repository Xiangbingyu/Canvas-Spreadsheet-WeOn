/**
 * 工作簿 store（文档级真源）
 *
 * - state 形状见 model/types WorkbookData
 * - workSheetStore 只镜像当前激活的一张 WorksheetData；改格请 dispatch 本 slice 的 updateCell / updateRange
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Style, WorkbookData, WorksheetData } from '@/spreadsheet/model/types'
import { createEmptySheet, generateNextSheetId } from '@/spreadsheet/utils/createEmptySheet'
import { applyUpdateCellToWorksheet } from '@/spreadsheet/utils/applyUpdateCell'

const initialState: WorkbookData = {
  docTitle: '',
  activeSheetId: '',
  sheetOrder: [],
  sheets: {},
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
    initFromDoc(state, action: PayloadAction<WorkbookData>) {
      const { docTitle, activeSheetId, sheetOrder, sheets } = action.payload
      state.docTitle = docTitle
      state.activeSheetId = activeSheetId
      state.sheetOrder = sheetOrder
      state.sheets = sheets
    },

    setDocTitle(state, action: PayloadAction<string>) {
      state.docTitle = action.payload
    },

    switchSheet(
      state,
      action: PayloadAction<{ savedSheet: WorksheetData; targetSheetId: string }>
    ) {
      const { savedSheet, targetSheetId } = action.payload
      if (!state.sheets[targetSheetId]) return
      state.sheets[state.activeSheetId] = savedSheet
      state.activeSheetId = targetSheetId
    },

    addSheet(state, action: PayloadAction<{ savedSheet: WorksheetData; sheetName: string }>) {
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

    applySheetAdded(
      state,
      action: PayloadAction<{
        sheetOrder: string[]
        sheet: WorksheetData
        replaceSheetId?: string
      }>
    ) {
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

    importWorkbook(
      state,
      action: PayloadAction<{
        activeSheetId: string
        sheetOrder: string[]
        sheets: Record<string, WorksheetData>
      }>
    ) {
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

    updateCell(
      state,
      action: PayloadAction<{
        sheetId: string
        row: number
        col: number
        value: string
        style?: Style | null
      }>
    ) {
      const { sheetId, ...input } = action.payload
      const sheet = state.sheets[sheetId]
      if (!sheet) return
      applyUpdateCellToWorksheet(sheet, input)
    },

    updateRange(
      state,
      action: PayloadAction<{
        sheetId: string
        updates: Array<{
          row: number
          col: number
          value: string
          style?: Style | null
        }>
      }>
    ) {
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
