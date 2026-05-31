// 本地 Undo/Redo Hook
//
// 包装单元格提交：每次本地提交前先读 store 里的「变更前快照」，连同「变更后」推入历史栈，
// 再调用真实 commit（走协同链路）。undo/redo 通过同一个 commit 回放反向/正向快照，
// 因此不直接改 Redux（H2：统一走 commit 管道，不双写），且只回滚本地自己的操作。

import { useCallback, useEffect, useRef } from 'react'
import { useStore } from 'react-redux'
import { HistoryStack, type CellOperation, type CellSnapshot } from '@/spreadsheet/history'
import type { RootState } from '@/spreadsheet/store'
import type { Style } from '@/spreadsheet/model/types'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'

export interface UseHistoryResult {
  /** 包装后的提交函数：执行写入并记录历史。替代直接调用 onCommitCell。 */
  commitWithHistory: CommitCellFn
  undo: () => void
  redo: () => void
}

/**
 * @param onCommitCell 真实提交（走 WS）。缺省时回放也无处可去，undo/redo 变为 no-op。
 */
export function useHistory(onCommitCell?: CommitCellFn): UseHistoryResult {
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

  const replay = useCallback(
    (op: CellOperation, snap: CellSnapshot) => {
      rawCommit(op.row, op.col, snap.value, snap.style)
    },
    [rawCommit]
  )

  const undo = useCallback(() => {
    const op = historyRef.current.popUndo()
    if (op && 'before' in op) {
      const cellOp = op as CellOperation
      replay(cellOp, cellOp.before)
    }
  }, [replay])

  const redo = useCallback(() => {
    const op = historyRef.current.popRedo()
    if (op && 'after' in op) {
      const cellOp = op as CellOperation
      replay(cellOp, cellOp.after)
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
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  return { commitWithHistory, undo, redo }
}
