import type { WorksheetData } from '@/spreadsheet/model/types'

/** 工作簿数据结构（纯前端；后端 snapshot 仍为单 sheet） */
export interface WorkbookData {
  title: string
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
}
