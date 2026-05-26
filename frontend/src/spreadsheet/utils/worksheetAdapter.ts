// Converts external worksheet Map models into renderer-ready snapshots.
// Keeps data normalization outside the Canvas renderer hot path.
import {
  cellKey,
  type Cell,
  type Style,
  type Worksheet,
  type WorksheetInput,
  type WorksheetSnapshot,
} from '@/spreadsheet/model/types'

const DEFAULT_WORKSHEET_ROW_COUNT = 200
const DEFAULT_WORKSHEET_COL_COUNT = 60

export function isWorksheet(input: WorksheetInput): input is Worksheet {
  return input.cells instanceof Map && input.styles instanceof Map
}

export function worksheetToSnapshot(worksheet: Worksheet): WorksheetSnapshot {
  const cells: Record<string, Cell> = {}
  const styles: Record<string, Style> = Object.fromEntries(worksheet.styles)
  let maxRow = -1
  let maxCol = -1

  worksheet.cells.forEach((cell) => {
    const key = cellKey(cell)
    cells[key] = cell
    maxRow = Math.max(maxRow, cell.row)
    maxCol = Math.max(maxCol, cell.col)
  })

  return {
    rowCount: Math.max(worksheet.rowCount ?? DEFAULT_WORKSHEET_ROW_COUNT, maxRow + 1),
    colCount: Math.max(worksheet.colCount ?? DEFAULT_WORKSHEET_COL_COUNT, maxCol + 1),
    cells,
    styles,
  }
}

export function normalizeWorksheetInput(input: WorksheetInput): WorksheetSnapshot {
  return isWorksheet(input) ? worksheetToSnapshot(input) : input
}
