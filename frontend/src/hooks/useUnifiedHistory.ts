// 统一的 undo/redo Hook
//
// 支持单元格编辑和行列操作的混合历史栈
// - 单元格变更：记录变更前后快照
// - 行列操作：记录操作类型和索引
// - 共享一个 HistoryStack，undo/redo 统一处理

import { useCallback, useEffect, useRef } from 'react'
import { useDispatch, useStore, batch } from 'react-redux'
import {
  HistoryStack,
  type CellOperation,
  type CellSnapshot,
  type RowColOperation,
  type BatchCellOperation,
} from '@/spreadsheet/history'
import { insertRow, deleteRow, insertCol, deleteCol } from '@/spreadsheet/store/workSheetStore'
import type { RootState } from '@/spreadsheet/store'
import type { Style } from '@/spreadsheet/model/types'
import type { Cell } from '@/spreadsheet/model/types'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'
import type { CollabClient } from '@/spreadsheet/collab/CollabClient'

export interface UseUnifiedHistoryResult {
  /** 包装后的提交函数：执行写入并记录历史。替代直接调用 onCommitCell。 */
  commitWithHistory: CommitCellFn
  /** 批量提交函数：多个单元格的修改作为一个原子操作 */
  commitBatchWithHistory: (
    updates: Array<{ row: number; col: number; value: string; style?: Style }>
  ) => void
  /** 行列操作的包装函数 */
  executeRowColWithHistory: (
    action: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col',
    index: number
  ) => void
  undo: () => void
  redo: () => void
}

/**
 * @param onCommitCell 真实提交（走 WS）。缺省时回放也无处可去，undo/redo 变为 no-op。
 * @param collabClient 协同客户端，用于发送行列操作到后端。缺省时行列操作只更新本地。
 */
export function useUnifiedHistory(
  onCommitCell?: CommitCellFn,
  collabClient?: CollabClient
): UseUnifiedHistoryResult {
  const dispatch = useDispatch()
  const reduxStore = useStore<RootState>()
  const historyRef = useRef<HistoryStack>(null as unknown as HistoryStack)
  if (historyRef.current === null) {
    historyRef.current = new HistoryStack()
  }

  // 把 onCommitCell 放进 ref，保证回调标识稳定，依赖它的函数无需重建
  const commitRef = useRef(onCommitCell)
  useEffect(() => {
    commitRef.current = onCommitCell
  }, [onCommitCell])

  /** 从 store 读某格当前快照（值 + 完整样式） */
  const readSnapshot = useCallback(
    (row: number, col: number): CellSnapshot => {
      const ws = reduxStore.getState().workSheet
      const cell = ws.cells[`${row}:${col}`]
      const style: Style = cell?.styleId ? (ws.styles[cell.styleId] ?? {}) : {}
      return { value: cell?.value ?? '', style }
    },
    [reduxStore]
  )

  // 读取完整行数据（所有列的单元格）
  const readRowData = useCallback(
    (row: number): Record<string, Cell | undefined> => {
      const ws = reduxStore.getState().workSheet
      const data: Record<string, Cell | undefined> = {}
      for (let col = 1; col <= ws.colCount; col++) {
        const key = `${row}:${col}`
        data[key] = ws.cells[key]
      }
      console.log('[useUnifiedHistory] readRowData for row', row, ':', data)
      return data
    },
    [reduxStore]
  )

  // 读取完整列数据（所有行的单元格）
  const readColData = useCallback(
    (col: number): Record<string, Cell | undefined> => {
      const ws = reduxStore.getState().workSheet
      const data: Record<string, Cell | undefined> = {}
      for (let row = 1; row <= ws.rowCount; row++) {
        const key = `${row}:${col}`
        data[key] = ws.cells[key]
      }
      console.log('[useUnifiedHistory] readColData for col', col, ':', data)
      return data
    },
    [reduxStore]
  )

  // 不记录历史地直接提交（用于 undo/redo 回放，避免回放本身再入栈）
  const rawCommit = useCallback((row: number, col: number, value: string, style?: Style) => {
    commitRef.current?.(row, col, value, style)
  }, [])

  // 用户编辑入口：先抓 before，提交后抓 after，入栈
  const commitWithHistory = useCallback<CommitCellFn>(
    (row, col, value, style) => {
      const before = readSnapshot(row, col)
      rawCommit(row, col, value, style)
      const after: CellSnapshot = { value, style: style ?? before.style }
      historyRef.current.push({ row, col, before, after })
    },
    [readSnapshot, rawCommit]
  )

  // 批量提交入口：多个单元格的修改作为一个原子操作
  const commitBatchWithHistory = useCallback(
    (updates: Array<{ row: number; col: number; value: string; style?: Style }>) => {
      const operations: CellOperation[] = []
      batch(() => {
        for (const { row, col, value, style } of updates) {
          const before = readSnapshot(row, col)
          rawCommit(row, col, value, style)
          const after: CellSnapshot = { value, style: style ?? before.style }
          operations.push({ row, col, before, after })
        }
      })
      if (operations.length > 0) {
        historyRef.current.push({ type: 'batch_cell', operations })
      }
    },
    [readSnapshot, rawCommit]
  )

  // 行列操作入口
  const executeRowColWithHistory = useCallback(
    (action: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col', index: number) => {
      console.log('[useUnifiedHistory] executeRowColWithHistory:', action, 'at index', index)
      let op: RowColOperation

      const sheetId = reduxStore.getState().workSheet.sheetId

      if (action === 'delete_row') {
        const data = readRowData(index)
        op = { type: 'delete_row', index, data }
        // 优先走 WS 协同链路，否则本地 dispatch
        if (collabClient) {
          collabClient.deleteRow(sheetId, index)
        } else {
          dispatch(deleteRow({ row: index }))
        }
      } else if (action === 'insert_row') {
        op = { type: 'insert_row', index }
        if (collabClient) {
          collabClient.insertRow(sheetId, index)
        } else {
          dispatch(insertRow({ row: index }))
        }
      } else if (action === 'delete_col') {
        const data = readColData(index)
        op = { type: 'delete_col', index, data }
        if (collabClient) {
          collabClient.deleteCol(sheetId, index)
        } else {
          dispatch(deleteCol({ col: index }))
        }
      } else {
        op = { type: 'insert_col', index }
        if (collabClient) {
          collabClient.insertCol(sheetId, index)
        } else {
          dispatch(insertCol({ col: index }))
        }
      }

      console.log('[useUnifiedHistory] pushing operation to history:', op)
      historyRef.current.push(op)
      console.log(
        '[useUnifiedHistory] history state - canUndo:',
        historyRef.current.canUndo,
        'canRedo:',
        historyRef.current.canRedo
      )
    },
    [dispatch, readRowData, readColData, collabClient, reduxStore]
  )

  const replayCellOp = useCallback(
    (op: CellOperation, snap: CellSnapshot) => {
      rawCommit(op.row, op.col, snap.value, snap.style)
    },
    [rawCommit]
  )

  const replayRowColOp = useCallback(
    (op: RowColOperation) => {
      if (op.type === 'insert_row') {
        dispatch(insertRow({ row: op.index }))
      } else if (op.type === 'delete_row') {
        dispatch(deleteRow({ row: op.index }))
      } else if (op.type === 'insert_col') {
        dispatch(insertCol({ col: op.index }))
      } else if (op.type === 'delete_col') {
        dispatch(deleteCol({ col: op.index }))
      }
    },
    [dispatch]
  )

  const undo = useCallback(() => {
    console.log('[useUnifiedHistory] undo triggered, canUndo:', historyRef.current.canUndo)
    const op = historyRef.current.popUndo()
    console.log('[useUnifiedHistory] popped operation:', op)
    if (!op) return

    if ('before' in op && 'after' in op) {
      // 单个单元格操作
      const cellOp = op as CellOperation
      console.log('[useUnifiedHistory] replaying cell undo')
      replayCellOp(cellOp, cellOp.before)
    } else if ('type' in op && op.type === 'batch_cell') {
      // 批量单元格操作 — 合并多个 dispatch 为一次
      const batchOp = op as BatchCellOperation
      console.log(
        '[useUnifiedHistory] replaying batch cell undo, count:',
        batchOp.operations.length
      )
      batch(() => {
        for (const cellOp of batchOp.operations) {
          replayCellOp(cellOp, cellOp.before)
        }
      })
    } else if ('type' in op) {
      // 行列操作
      const rowColOp = op as RowColOperation
      console.log(
        '[useUnifiedHistory] executing reverse row/col operation:',
        rowColOp.type,
        'data:',
        rowColOp.data
      )
      // 反向操作：insert → delete，delete → insert
      if (rowColOp.type === 'insert_row') {
        console.log('[useUnifiedHistory] undo insert_row → delete_row at index', rowColOp.index)
        replayRowColOp({ type: 'delete_row', index: rowColOp.index })
      } else if (rowColOp.type === 'delete_row') {
        console.log(
          '[useUnifiedHistory] undo delete_row → insert_row at index',
          rowColOp.index,
          'with data:',
          rowColOp.data
        )
        replayRowColOp({ type: 'insert_row', index: rowColOp.index })
        // 需要恢复被删除行的单元格数据
        if (rowColOp.data) {
          console.log(
            '[useUnifiedHistory] restoring deleted row data:',
            Object.keys(rowColOp.data).length,
            'cells'
          )
          const ws = reduxStore.getState().workSheet
          batch(() => {
            for (const [key, cell] of Object.entries(rowColOp.data ?? {})) {
              if (cell) {
                console.log('[useUnifiedHistory] restoring cell', key, ':', cell)
                const style = cell.styleId ? (ws.styles[cell.styleId] ?? {}) : undefined
                rawCommit(cell.row, cell.col, cell.value, style)
              }
            }
          })
        }
      } else if (rowColOp.type === 'insert_col') {
        console.log('[useUnifiedHistory] undo insert_col → delete_col at index', rowColOp.index)
        replayRowColOp({ type: 'delete_col', index: rowColOp.index })
      } else if (rowColOp.type === 'delete_col') {
        console.log(
          '[useUnifiedHistory] undo delete_col → insert_col at index',
          rowColOp.index,
          'with data:',
          rowColOp.data
        )
        replayRowColOp({ type: 'insert_col', index: rowColOp.index })
        // 需要恢复被删除列的单元格数据
        if (rowColOp.data) {
          console.log(
            '[useUnifiedHistory] restoring deleted col data:',
            Object.keys(rowColOp.data).length,
            'cells'
          )
          const ws = reduxStore.getState().workSheet
          batch(() => {
            for (const [key, cell] of Object.entries(rowColOp.data ?? {})) {
              if (cell) {
                console.log('[useUnifiedHistory] restoring cell', key, ':', cell)
                const style = cell.styleId ? (ws.styles[cell.styleId] ?? {}) : undefined
                rawCommit(cell.row, cell.col, cell.value, style)
              }
            }
          })
        }
      }
    }
  }, [replayCellOp, replayRowColOp, rawCommit, reduxStore])

  const redo = useCallback(() => {
    console.log('[useUnifiedHistory] redo triggered, canRedo:', historyRef.current.canRedo)
    const op = historyRef.current.popRedo()
    console.log('[useUnifiedHistory] popped redo operation:', op)
    if (!op) return

    if ('after' in op && 'before' in op) {
      // 单个单元格操作
      const cellOp = op as CellOperation
      console.log('[useUnifiedHistory] replaying cell redo')
      replayCellOp(cellOp, cellOp.after)
    } else if ('type' in op && op.type === 'batch_cell') {
      // 批量单元格操作 — 合并多个 dispatch 为一次
      const batchOp = op as BatchCellOperation
      console.log(
        '[useUnifiedHistory] replaying batch cell redo, count:',
        batchOp.operations.length
      )
      batch(() => {
        for (const cellOp of batchOp.operations) {
          replayCellOp(cellOp, cellOp.after)
        }
      })
    } else if ('type' in op) {
      // 行列操作
      console.log('[useUnifiedHistory] replaying row/col operation:', op.type)
      replayRowColOp(op as RowColOperation)
    }
  }, [replayCellOp, replayRowColOp])

  // 快捷键：Ctrl+Z 撤销，Ctrl+Shift+Z 重做（编辑态下不拦截，交给 textarea）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      e.preventDefault()
      console.log('[useUnifiedHistory] keyboard shortcut triggered, shiftKey:', e.shiftKey)
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  return { commitWithHistory, commitBatchWithHistory, executeRowColWithHistory, undo, redo }
}
