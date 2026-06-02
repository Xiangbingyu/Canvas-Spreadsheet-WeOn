import type { WorksheetData } from '@/spreadsheet/model/types'

export type ExcelExportScope = 'current' | 'all'

export type ExcelExportWorkbookInput = {
  title: string
  scope: ExcelExportScope
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
}

export type ExcelExportResult = 'saved' | 'cancelled'
