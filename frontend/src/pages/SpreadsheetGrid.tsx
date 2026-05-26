// Page-level adapter that binds Redux spreadsheet state to the CanvasSpreadsheet component.
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

export function SpreadsheetGrid() {
  const dispatch = useAppDispatch()
  const spreadsheet = useAppSelector(selectSpreadsheet)
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
      rowCount={spreadsheet.rowCount}
      colCount={spreadsheet.colCount}
      cells={spreadsheet.cells}
      styles={spreadsheet.styles}
      selection={spreadsheet.selection}
      editingCell={spreadsheet.editingCell}
      callbacks={callbacks}
      onViewportChange={handleViewportChange}
    />
  )
}
