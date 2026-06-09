// 单元格提交回调：协同开走 setCell / batch_set_cell / set_range_values，关则本地 dispatch。

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

type SetRangeValuesFn = (
  sheetId: string,
  cells: Array<{ row: number; col: number; value: string; styleId?: string | null }>,
  styles?: Record<string, Record<string, unknown>>
) => void

export type BatchCommitFn = (
  updates: Array<{ row: number; col: number; value: string; style?: Style }>
) => void

function toRangeWirePayload(
  updates: Array<{ row: number; col: number; value: string; style?: Style }>
) {
  const styles: Record<string, Record<string, unknown>> = {}
  const cells = updates.map((u) => {
    const cell: { row: number; col: number; value: string; styleId?: string | null } = {
      row: u.row,
      col: u.col,
      value: u.value,
    }
    if (u.style !== undefined) {
      if (isEmptyStyle(u.style)) {
        cell.styleId = null
      } else {
        const styleId = generateStyleId(u.style!)
        if (!styles[styleId]) {
          styles[styleId] = u.style! as unknown as Record<string, unknown>
        }
        cell.styleId = styleId
      }
    }
    return cell
  })
  return { cells, styles: Object.keys(styles).length > 0 ? styles : undefined }
}

function allSameSnapshot(
  updates: Array<{ row: number; col: number; value: string; style?: Style }>
): boolean {
  const first = updates[0]
  return updates.every(
    (u) =>
      u.value === first.value &&
      generateStyleId(u.style ?? {}) === generateStyleId(first.style ?? {})
  )
}

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
 * 批量提交：整批快照一致走 batch_set_cell，逐格不同走 set_range_values。
 * @param setBatchCells 协同 batch_set_cell
 * @param setRangeValues 协同 set_range_values（批量撤回回放等）
 */
export function useCommitBatch(
  setBatchCells?: BatchSetCellFn,
  setRangeValues?: SetRangeValuesFn
): BatchCommitFn {
  const dispatch = useDispatch()
  const store = useStore<RootState>()

  return useMemo<BatchCommitFn>(
    () => (updates) => {
      if (updates.length === 0) return
      const sheetId = store.getState().workSheet.sheetId

      if (setRangeValues && !allSameSnapshot(updates)) {
        const { cells, styles } = toRangeWirePayload(updates)
        setRangeValues(sheetId, cells, styles)
        return
      }

      if (setBatchCells) {
        const targets = updates.map((u) => ({ row: u.row, col: u.col }))
        const allSameValue = updates.every((u) => u.value === updates[0].value)
        const patch: { value?: string; style?: Record<string, unknown> | null } = {}
        if (updates[0].style !== undefined) {
          patch.style = isEmptyStyle(updates[0].style)
            ? null
            : (updates[0].style as unknown as Record<string, unknown>)
        }
        if (allSameValue) {
          patch.value = updates[0].value
        }
        setBatchCells(sheetId, targets, patch)
        return
      }

      dispatch(updateRange({ sheetId, updates }))
    },
    [setBatchCells, setRangeValues, dispatch, store]
  )
}
