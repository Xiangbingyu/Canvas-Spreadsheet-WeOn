import type { WorksheetData } from '@/spreadsheet/model/types'

const DEFAULT_ROW_COUNT = 1000
const DEFAULT_COL_COUNT = 1000

/** 生成前端本地新建 sheet 的 id（不与服务端 snapshot.id 冲突） */
export function generateNextSheetId(existingIds: string[]): string {
  let index = existingIds.length + 1
  let id = `local_${String(index).padStart(3, '0')}`
  while (existingIds.includes(id)) {
    index += 1
    id = `local_${String(index).padStart(3, '0')}`
  }
  return id
}

export function createEmptySheet(sheetId: string, sheetName: string): WorksheetData {
  return {
    sheetId,
    sheetName,
    defaultRowHeight: 25,
    defaultColWidth: 100,
    rowCount: DEFAULT_ROW_COUNT,
    colCount: DEFAULT_COL_COUNT,
    styles: {},
    cells: {},
  }
}
