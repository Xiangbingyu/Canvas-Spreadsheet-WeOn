/** 将一格 set_cell 语义写入 WorksheetData（就地修改，无返回值） */
import type { Cell, Style, WorksheetData } from '@/spreadsheet/model/types'
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'

export function applyUpdateCellToWorksheet(
  sheet: WorksheetData,
  input: { row: number; col: number; value: string; style?: Style | null }
) {
  const { row, col, value, style } = input

  if (row < 1 || col < 1 || row > sheet.rowCount || col > sheet.colCount) {
    return
  }

  const key = `${row}:${col}`
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
