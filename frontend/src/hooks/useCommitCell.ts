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
  sheetId: string,
  targets: Array<{ row: number; col: number }>,
  patch: { value?: string; style?: Record<string, unknown> | null }
) => void

export type BatchCommitFn = (
  updates: Array<{ row: number; col: number; value: string; style?: Style }>
) => void

/**
 * @param setCell 由 SpreadsheetPage 通过 useCollab 注入；协同关闭时可不传
 */
export function useCommitCell(setCell?: SetCellFn): CommitCellFn {
  const dispatch = useDispatch()
  const store = useStore<RootState>()

  return useMemo<CommitCellFn>(
    () =>
      setCell
        ? (row, col, value, style) =>
            setCell(row, col, value, style as unknown as Record<string, unknown> | undefined)
        : (row, col, value, style) => {
            const sheetId = store.getState().workSheet.sheetId
            dispatch(updateCell({ sheetId, row, col, value, style }))
          },
    [setCell, dispatch, store]
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
        ? (updates) => {
            if (updates.length === 0) return
            const sheetId = store.getState().workSheet.sheetId
            const targets = updates.map((u) => ({ row: u.row, col: u.col }))
            // batch_set_cell 是「一批坐标 + 一个统一 patch」：value 只能整批共享。
            // 仅当整批 value 完全一致时才带 value（批量改内容/撤回回放场景）；
            // 否则只带 style（批量改样式场景），由后端「只传 style 保留各格原值」语义守住内容，
            // 避免把起始格的值覆盖到整个选区。
            const allSameValue = updates.every((u) => u.value === updates[0].value)
            const patch: { value?: string; style?: Record<string, unknown> | null } = {
              style: (updates[0].style ?? null) as unknown as Record<string, unknown> | null,
            }
            if (allSameValue) {
              patch.value = updates[0].value
            }
            setBatchCells(sheetId, targets, patch)
          }
        : (updates) => {
            const sheetId = store.getState().workSheet.sheetId
            dispatch(updateRange({ sheetId, updates }))
          },
    [setBatchCells, dispatch, store]
  )
}
