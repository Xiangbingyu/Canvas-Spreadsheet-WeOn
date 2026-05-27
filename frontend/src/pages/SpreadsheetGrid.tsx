// Page-level adapter that binds Redux spreadsheet state to the CanvasSpreadsheet component.
// Input: workSheet and spreadsheet Redux state; output: CanvasSpreadsheet props.
import { useCallback, useMemo } from 'react'
import { CanvasSpreadsheet } from '@/components/CanvasSpreadsheet'
import type { InteractionCallbacks } from '@/spreadsheet/interaction/interaction'
import type { ViewportState } from '@/spreadsheet/model/types'
import {
  selectSpreadsheet,
  setActiveCell,
  setEditingCell,
  setSelection,
  setViewport,
} from '@/spreadsheet/store/spreadsheetSlice'
import { useAppDispatch, useAppSelector } from '@/spreadsheet/store/store'
import { selectWorksheet } from '@/spreadsheet/store/workSheetSlice'
import { worksheetDataToSnapshot } from '@/spreadsheet/utils/worksheetAdapter'

export function SpreadsheetGrid() {
  const dispatch = useAppDispatch()
  const spreadsheetUi = useAppSelector(selectSpreadsheet)
  const worksheet = useAppSelector(selectWorksheet)
  const snapshot = useMemo(() => worksheetDataToSnapshot(worksheet), [worksheet])
  const handleViewportChange = useCallback(
    (viewport: ViewportState) => {
      dispatch(setViewport(viewport))
    },
    [dispatch]
  )

  const callbacks = useMemo<InteractionCallbacks>(
    () => ({
      onCellClick: ({ coord }) => {
        dispatch(setEditingCell(null))
        dispatch(setActiveCell(coord))
      },
      onCellDoubleClick: ({ coord }) => {
        dispatch(setEditingCell(coord))
      },
      onSelectionChange: ({ newSelection }) => {
        dispatch(setEditingCell(null))
        dispatch(setSelection(newSelection))
      },
      onCanvasClick: () => {
        dispatch(setEditingCell(null))
      },
    }),
    [dispatch]
  )

  return (
    <CanvasSpreadsheet
      rowCount={snapshot.rowCount}
      colCount={snapshot.colCount}
      cells={snapshot.cells}
      styles={snapshot.styles}
      selection={spreadsheetUi.selection}
      editingCell={spreadsheetUi.editingCell}
      config={{
        rowHeight: worksheet.defaultRowHeight,
        colWidth: worksheet.defaultColWidth,
      }}
      callbacks={callbacks}
      onViewportChange={handleViewportChange}
    />
  )
}
