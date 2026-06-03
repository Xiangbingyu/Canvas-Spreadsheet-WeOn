// 单元格提交回调：协同开走 setCell，关则本地 dispatch(updateCell)。

import { useMemo } from 'react'
import { useDispatch, useStore } from 'react-redux'
import { updateCell, updateRange } from '@/spreadsheet/store/workSheetStore'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'
import type { RootState } from '@/spreadsheet/store'
import type { Style } from '@/spreadsheet/model/types'
import { generateStyleId, isEmptyStyle } from '@/spreadsheet/utils/generateStyleId'

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
            const allSameValue = updates.every((u) => u.value === updates[0].value)

            // batch_set_cell 只能表达「一批坐标 + 一个统一 patch」。
            // 当最终样式并不一致时，按最终样式分组发送，避免把第一格的完整样式覆盖到整组选区。
            const groupedUpdates = new Map<string, Array<(typeof updates)[number]>>()
            for (const update of updates) {
              const styleKey =
                update.style === undefined
                  ? '__style_undefined__'
                  : isEmptyStyle(update.style)
                    ? '__style_empty__'
                    : generateStyleId(update.style)
              const valueKey = allSameValue ? '__shared_value__' : update.value
              const groupKey = `${styleKey}::${valueKey}`
              const group = groupedUpdates.get(groupKey)
              if (group) {
                group.push(update)
              } else {
                groupedUpdates.set(groupKey, [update])
              }
            }

            for (const grouped of groupedUpdates.values()) {
              const targets = grouped.map((u) => ({ row: u.row, col: u.col }))
              const patch: { value?: string; style?: Record<string, unknown> | null } = {}

              if (allSameValue) {
                patch.value = grouped[0].value
              }
              if (grouped[0].style !== undefined) {
                patch.style = isEmptyStyle(grouped[0].style)
                  ? null
                  : (grouped[0].style as unknown as Record<string, unknown>)
              }

              setBatchCells(sheetId, targets, patch)
            }
          }
        : (updates) => {
            const sheetId = store.getState().workSheet.sheetId
            dispatch(updateRange({ sheetId, updates }))
          },
    [setBatchCells, dispatch, store]
  )
}
