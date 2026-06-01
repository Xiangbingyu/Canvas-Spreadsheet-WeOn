// 单元格提交回调：协同开走 setCell，关则本地 dispatch(updateCell)。

import { useMemo } from 'react'
import { useDispatch, useStore } from 'react-redux'
import { updateCell, updateRange } from '@/spreadsheet/store/workSheetStore'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'
import type { RootState } from '@/spreadsheet/store'
import type { Style } from '@/spreadsheet/model/types'

type SetCellFn = (
  row: number,
  col: number,
  value: string,
  style?: Record<string, unknown> | null
) => void

type BatchSetCellFn = (
  updates: Array<{
    row: number
    col: number
    value: string
    style?: Record<string, unknown> | null
  }>
) => void

export type BatchCommitFn = (
  updates: Array<{ row: number; col: number; value: string; style?: Style }>
) => void

/**
 * @param setCell 由 SpreadsheetPage 通过 useCollab 注入；协同关闭时可不传
 */
export function useCommitCell(setCell?: SetCellFn): CommitCellFn {
  const dispatch = useDispatch()

  return useMemo<CommitCellFn>(
    () =>
      setCell
        ? (row, col, value, style) =>
            setCell(row, col, value, style as unknown as Record<string, unknown> | undefined)
        : (row, col, value, style) => dispatch(updateCell({ row, col, value, style })),
    [setCell, dispatch]
  )
}

/**
 * 批量提交单元格（原子操作）
 * @param setBatchCells 由 SpreadsheetPage 通过 useCollab 注入；协同关闭时可不传
 */
export function useCommitBatch(setBatchCells?: BatchSetCellFn): BatchCommitFn {
  const dispatch = useDispatch()
  const store = useStore<RootState>()

  return useMemo<BatchCommitFn>(
    () =>
      setBatchCells
        ? (updates) =>
            setBatchCells(
              updates.map((u) => ({
                row: u.row,
                col: u.col,
                value: u.value,
                style: u.style as unknown as Record<string, unknown> | null,
              }))
            )
        : (updates) => {
            const sheetId = store.getState().workSheet.sheetId
            dispatch(updateRange({ sheetId, updates }))
          },
    [setBatchCells, dispatch, store]
  )
}
