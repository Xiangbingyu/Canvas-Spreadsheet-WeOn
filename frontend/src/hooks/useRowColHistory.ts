// 行列操作的 undo/redo Hook
//
// 包装 insertRow/deleteRow/insertCol/deleteCol：
// - 删除前读取完整行/列数据
// - 先调用 collab 方法发送 WS
// - 执行本地操作并记录历史
// - undo/redo 通过同一个 dispatch 回放反向/正向操作

import { useCallback, useEffect, useRef } from 'react'
import { useDispatch, useStore } from 'react-redux'
import { HistoryStack, type RowColOperation } from '@/spreadsheet/history'
import { insertRow, deleteRow, insertCol, deleteCol } from '@/spreadsheet/store/workSheetStore'
import type { RootState } from '@/spreadsheet/store'
import type { Cell } from '@/spreadsheet/model/types'

export interface UseRowColHistoryResult {
  executeWithHistory: (
    action: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col',
    index: number
  ) => void
  undo: () => void
  redo: () => void
}

export interface CollabRowColMethods {
  insertRow: (sheetId: string, row: number) => void
  deleteRow: (sheetId: string, row: number) => void
  insertCol: (sheetId: string, col: number) => void
  deleteCol: (sheetId: string, col: number) => void
}

export function useRowColHistory(collab?: CollabRowColMethods): UseRowColHistoryResult {
  const dispatch = useDispatch()
  const reduxStore = useStore<RootState>()
  const historyRef = useRef<HistoryStack>(null as unknown as HistoryStack)
  if (historyRef.current === null) {
    historyRef.current = new HistoryStack()
  }

  // 读取完整行数据（所有列的单元格）
  const readRowData = useCallback(
    (row: number): Record<string, Cell | undefined> => {
      const ws = reduxStore.getState().workSheet
      const data: Record<string, Cell | undefined> = {}
      for (let col = 1; col <= ws.colCount; col++) {
        const key = `${row}:${col}`
        data[key] = ws.cells[key]
      }
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
      return data
    },
    [reduxStore]
  )

  const executeWithHistory = useCallback(
    (action: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col', index: number) => {
      console.log('[useRowColHistory] executeWithHistory:', action, 'at index', index)
      const state = reduxStore.getState()
      const sheetId = state.workSheet.sheetId
      let op: RowColOperation

      // 先调用 collab 方法发送 WS
      if (action === 'delete_row') {
        const data = readRowData(index)
        op = { type: 'delete_row', index, data }
        collab?.deleteRow(sheetId, index)
        dispatch(deleteRow({ row: index }))
      } else if (action === 'insert_row') {
        op = { type: 'insert_row', index }
        collab?.insertRow(sheetId, index)
        dispatch(insertRow({ row: index }))
      } else if (action === 'delete_col') {
        const data = readColData(index)
        op = { type: 'delete_col', index, data }
        collab?.deleteCol(sheetId, index)
        dispatch(deleteCol({ col: index }))
      } else {
        op = { type: 'insert_col', index }
        collab?.insertCol(sheetId, index)
        dispatch(insertCol({ col: index }))
      }

      console.log('[useRowColHistory] pushing operation to history:', op)
      historyRef.current.push(op)
      console.log(
        '[useRowColHistory] history state - canUndo:',
        historyRef.current.canUndo,
        'canRedo:',
        historyRef.current.canRedo
      )
    },
    [dispatch, readRowData, readColData, reduxStore, collab]
  )

  const replay = useCallback(
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
    console.log('[useRowColHistory] undo triggered, canUndo:', historyRef.current.canUndo)
    const op = historyRef.current.popUndo()
    console.log('[useRowColHistory] popped operation:', op)
    if (op && 'type' in op) {
      const rowColOp = op as RowColOperation
      console.log('[useRowColHistory] executing reverse operation:', rowColOp.type)
      // 反向操作：insert → delete，delete → insert
      if (rowColOp.type === 'insert_row') {
        console.log(
          '[useRowColHistory] reversing insert_row to delete_row at index',
          rowColOp.index
        )
        replay({ type: 'delete_row', index: rowColOp.index })
      } else if (rowColOp.type === 'delete_row') {
        console.log(
          '[useRowColHistory] reversing delete_row to insert_row at index',
          rowColOp.index
        )
        replay({ type: 'insert_row', index: rowColOp.index })
      } else if (rowColOp.type === 'insert_col') {
        console.log(
          '[useRowColHistory] reversing insert_col to delete_col at index',
          rowColOp.index
        )
        replay({ type: 'delete_col', index: rowColOp.index })
      } else if (rowColOp.type === 'delete_col') {
        console.log(
          '[useRowColHistory] reversing delete_col to insert_col at index',
          rowColOp.index
        )
        replay({ type: 'insert_col', index: rowColOp.index })
      }
    }
  }, [replay])

  const redo = useCallback(() => {
    console.log('[useRowColHistory] redo triggered, canRedo:', historyRef.current.canRedo)
    const op = historyRef.current.popRedo()
    console.log('[useRowColHistory] popped redo operation:', op)
    if (op && 'type' in op) {
      console.log('[useRowColHistory] replaying operation:', op.type)
      replay(op as RowColOperation)
    }
  }, [replay])

  // 快捷键：Ctrl+Z 撤销，Ctrl+Shift+Z 重做（编辑态下不拦截，交给 textarea）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      e.preventDefault()
      console.log('[useRowColHistory] keyboard shortcut triggered, shiftKey:', e.shiftKey)
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  return { executeWithHistory, undo, redo }
}
