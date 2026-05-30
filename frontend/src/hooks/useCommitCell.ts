// 单元格提交回调：协同开走 setCell，关则本地 dispatch(updateCell)。

import { useMemo } from 'react'
import { useDispatch } from 'react-redux'
import { updateCell } from '@/spreadsheet/store/workSheetStore'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'

type SetCellFn = (
  row: number,
  col: number,
  value?: string,
  style?: Record<string, unknown> | null
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
