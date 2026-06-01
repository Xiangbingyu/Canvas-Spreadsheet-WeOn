import type { Cell, Style, WorksheetData } from '@/spreadsheet/model/types'
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'

/** 单元格增量字段（不含 sheetId），与 WS set_cell 对齐 */
export type ApplyUpdateCellInput = {
  row: number
  col: number
  value: string
  style?: Style | null
}

/** dispatch(updateCell) 的 payload，与 WS set_cell 字段对齐（sheetId 必填） */
export type UpdateCellPayload = {
  sheetId: string
} & ApplyUpdateCellInput

/** 将 set_cell 语义应用到指定 WorksheetData（可用于 Immer draft） */
export function applyUpdateCellToWorksheet(
  sheet: WorksheetData,
  input: ApplyUpdateCellInput
): void {
  const { row, col, value, style } = input
  const key = `${row}:${col}`

  if (row < 1 || col < 1 || row > sheet.rowCount || col > sheet.colCount) {
    return
  }

  const prev = sheet.cells[key]

  if (value === '' && style === undefined) {
    delete sheet.cells[key]
    return
  }

  let styleId: string | undefined
  if (style === null) {
    styleId = undefined
  } else if (style !== undefined) {
    styleId = findOrCreateStyleId(sheet.styles, style)
  } else {
    styleId = prev?.styleId
  }

  const nextCell: Cell = { row, col, value }
  if (styleId !== undefined) {
    nextCell.styleId = styleId
  }
  sheet.cells[key] = nextCell
}
