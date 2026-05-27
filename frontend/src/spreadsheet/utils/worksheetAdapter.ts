// Converts imported worksheet records into renderer-ready snapshots.
// Keeps data normalization outside the Canvas renderer hot path.
// Input: 1-based WorksheetData from Excel Redux; output: 0-based WorksheetSnapshot.
import {
  cellKey,
  type Cell,
  type WorksheetData,
  type WorksheetSnapshot,
} from '@/spreadsheet/model/types'

const DEFAULT_WORKSHEET_ROW_COUNT = 200
const DEFAULT_WORKSHEET_COL_COUNT = 60

export function worksheetDataToSnapshot(worksheet: WorksheetData): WorksheetSnapshot {
  const cells: Record<string, Cell> = {}
  let maxRow = -1
  let maxCol = -1

  Object.values(worksheet.cells).forEach((cell) => {
    if (cell.row <= 0 || cell.col <= 0) {
      return
    }

    const normalizedCell = {
      ...cell,
      row: cell.row - 1,
      col: cell.col - 1,
    }

    cells[cellKey(normalizedCell)] = normalizedCell
    maxRow = Math.max(maxRow, normalizedCell.row)
    maxCol = Math.max(maxCol, normalizedCell.col)
  })

  return {
    rowCount: Math.max(DEFAULT_WORKSHEET_ROW_COUNT, maxRow + 1),
    colCount: Math.max(DEFAULT_WORKSHEET_COL_COUNT, maxCol + 1),
    cells,
    styles: worksheet.styles,
  }
}
