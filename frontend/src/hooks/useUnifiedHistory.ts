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
import { generateStyleId } from '@/spreadsheet/utils/generateStyleId'
import type { RootState } from '@/spreadsheet/store'
import type { Style } from '@/spreadsheet/model/types'
import type { Cell } from '@/spreadsheet/model/types'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'
import type { BatchCommitFn } from '@/hooks/useCommitCell'
import type { CollabClient } from '@/spreadsheet/collab/CollabClient'

/**
 * 批量回放多组消息时的发送间隔（毫秒）。
 * 后端每条 batch_set_cell 都要抢文档锁并跑一次事务，锁等待超时 3s。
 * 串行间隔发送可错开抢锁时机，避免并发抢锁超时。取值需 < 后端锁 TTL 且足够小不影响体感。
 */
const GROUP_SEND_GAP_MS = 60

export interface UseUnifiedHistoryResult {
  /** 包装后的提交函数：执行写入并记录历史。替代直接调用 onCommitCell。 */
  commitWithHistory: CommitCellFn
  /** 批量提交函数：多个单元格的修改作为一个原子操作 */
  commitBatchWithHistory: BatchCommitFn
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
 * @param onCommitBatch 批量提交（走 WS batch_set_cell）。缺省时用 onCommitCell 逐个提交。
 * @param collabClient 协同客户端，用于发送行列操作到后端。缺省时行列操作只更新本地。
 */
export function useUnifiedHistory(
  onCommitCell?: CommitCellFn,
  onCommitBatch?: BatchCommitFn,
  collabClient?: CollabClient
): UseUnifiedHistoryResult {
  const dispatch = useDispatch()
  const reduxStore = useStore<RootState>()
  const historyRef = useRef<HistoryStack>(null as unknown as HistoryStack)
  if (historyRef.current === null) {
    historyRef.current = new HistoryStack()
  }

  // 把 onCommitCell 和 onCommitBatch 放进 ref，保证回调标识稳定
  const commitRef = useRef(onCommitCell)
  const batchCommitRef = useRef(onCommitBatch)
  useEffect(() => {
    commitRef.current = onCommitCell
  }, [onCommitCell])
  useEffect(() => {
    batchCommitRef.current = onCommitBatch
  }, [onCommitBatch])

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

  // 不记录历史地直接提交（用于 undo/redo 回放，避免回放本身再入栈）
  const rawCommit = useCallback((row: number, col: number, value: string, style?: Style) => {
    commitRef.current?.(row, col, value, style)
  }, [])

  /**
   * 批量回放一组单元格操作：把每格还原成指定快照（undo→before / redo→after）。
   * batch_set_cell 协议是「一批坐标 + 一个统一 patch」，无法表达 N 格还原成 N 个不同状态，
   * 因此先按目标快照分组，每组内状态一致 → 各发一条 batch；
   * 无批量提交通道（batchCommitRef 缺省）时退回逐格 rawCommit。
   *
   * 分组维度按操作类型自适应（P1 关键优化）：
   * - 纯样式操作（批量内每格 before.value === after.value，内容未变，如 Toolbar 改样式）：
   *   只按 style 分组（key = styleId）。原样式相同的格子合成一组，
   *   组数从 N（各格内容不同）降到「样式种类数」（通常为 1）。
   *   useCommitBatch 检测到组内 value 不全相同时只发 style（后端保留各格原值），
   *   既正确还原样式、又不误改内容，根治「各格内容不同 + 统一样式 + 撤回」的 doc lock 风暴。
   * - 含内容变更的操作（如粘贴）：仍按 value+style 分组，必须还原各格 value。
   *
   * 多组消息「串行间隔发送」而非同步循环连发：后端 WS 收到一条就立即异步处理、
   * 每条 batch_set_cell 都要抢同一把文档锁（withDocLock，等待超时仅 3s）。
   * 同步循环连发 N 条会让后端并发抢锁、部分超时报 5000 + 对应格子还原失败。
   * 改为按 GROUP_SEND_GAP_MS 间隔逐条发送，错开抢锁时机。单组（最常见）瞬发无延迟。
   */
  const replayBatch = useCallback(
    (operations: CellOperation[], pick: (op: CellOperation) => CellSnapshot) => {
      if (operations.length === 0) return

      if (!batchCommitRef.current) {
        batch(() => {
          for (const op of operations) {
            const snap = pick(op)
            rawCommit(op.row, op.col, snap.value, snap.style)
          }
        })
        return
      }

      // 纯样式操作：整批每格内容都没变（before.value === after.value），
      // 撤回/重做只需还原 style，不必碰 value → 只按 styleId 分组。
      const isStyleOnly = operations.every((op) => op.before.value === op.after.value)

      // 按目标快照分组。纯样式按 styleId；含内容变更按 value+styleId。
      // 使用 generateStyleId 确保 style key 稳定（不依赖属性顺序）。
      const groups = new Map<
        string,
        Array<{ row: number; col: number; value: string; style?: Style }>
      >()
      for (const op of operations) {
        const snap = pick(op)
        const styleKey = generateStyleId(snap.style ?? {})
        const key = isStyleOnly ? styleKey : `${snap.value}|${styleKey}`
        const group = groups.get(key)
        const entry = { row: op.row, col: op.col, value: snap.value, style: snap.style }
        if (group) {
          group.push(entry)
        } else {
          groups.set(key, [entry])
        }
      }

      const groupList = Array.from(groups.values())

      // 单组：直接发送，无需排队（最常见的「整片刷同一样式撤回」走这条）
      if (groupList.length <= 1) {
        if (groupList[0]) batchCommitRef.current(groupList[0])
        return
      }

      // 多组：串行间隔发送，错开后端抢锁时机，避免并发抢同一把文档锁而超时
      let index = 0
      const sendNext = () => {
        const commit = batchCommitRef.current
        if (!commit || index >= groupList.length) return
        commit(groupList[index])
        index += 1
        if (index < groupList.length) {
          setTimeout(sendNext, GROUP_SEND_GAP_MS)
        }
      }
      sendNext()
    },
    [rawCommit]
  )

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
  const commitBatchWithHistory = useCallback<BatchCommitFn>(
    (updates: Array<{ row: number; col: number; value: string; style?: Style }>) => {
      const operations: CellOperation[] = updates.map(({ row, col, value, style }) => {
        const before = readSnapshot(row, col)
        const after: CellSnapshot = { value, style: style ?? before.style }
        return { row, col, before, after }
      })

      // 一次批量提交，不再逐个调用 rawCommit
      if (batchCommitRef.current) {
        batchCommitRef.current(updates)
      } else if (commitRef.current) {
        // 降级：无批量提交时，逐个调用单个提交
        batch(() => {
          for (const { row, col, value, style } of updates) {
            commitRef.current?.(row, col, value, style)
          }
        })
      }

      if (operations.length > 0) {
        historyRef.current.push({ type: 'batch_cell', operations })
      }
    },
    [readSnapshot]
  )

  // 行列操作入口
  const executeRowColWithHistory = useCallback(
    (action: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col', index: number) => {
      let op: RowColOperation

      const sheetId = reduxStore.getState().workSheet.sheetId

      const online = collabClient?.isConnected && (navigator?.onLine ?? true)

      if (action === 'delete_row') {
        const data = readRowData(index)
        op = { type: 'delete_row', index, data }
        if (!online) dispatch(deleteRow({ row: index }))
        collabClient?.deleteRow(sheetId, index)
      } else if (action === 'insert_row') {
        op = { type: 'insert_row', index }
        if (!online) dispatch(insertRow({ row: index }))
        collabClient?.insertRow(sheetId, index)
      } else if (action === 'delete_col') {
        const data = readColData(index)
        op = { type: 'delete_col', index, data }
        if (!online) dispatch(deleteCol({ col: index }))
        collabClient?.deleteCol(sheetId, index)
      } else {
        op = { type: 'insert_col', index }
        if (!online) dispatch(insertCol({ col: index }))
        collabClient?.insertCol(sheetId, index)
      }

      historyRef.current.push(op)
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
    const op = historyRef.current.popUndo()
    if (!op) return

    if ('before' in op && 'after' in op) {
      // 单个单元格操作
      const cellOp = op as CellOperation
      replayCellOp(cellOp, cellOp.before)
    } else if ('type' in op && op.type === 'batch_cell') {
      // 批量单元格操作 — 按快照分组走 batch_set_cell 回放，避免逐格打爆 WS
      const batchOp = op as BatchCellOperation
      replayBatch(batchOp.operations, (cellOp) => cellOp.before)
    } else if ('type' in op) {
      // 行列操作
      const rowColOp = op as RowColOperation
      // 反向操作：insert → delete，delete → insert
      if (rowColOp.type === 'insert_row') {
        replayRowColOp({ type: 'delete_row', index: rowColOp.index })
      } else if (rowColOp.type === 'delete_row') {
        replayRowColOp({ type: 'insert_row', index: rowColOp.index })
        // 需要恢复被删除行的单元格数据
        if (rowColOp.data) {
          const ws = reduxStore.getState().workSheet
          batch(() => {
            for (const [, cell] of Object.entries(rowColOp.data ?? {})) {
              if (cell) {
                const style = cell.styleId ? (ws.styles[cell.styleId] ?? {}) : undefined
                rawCommit(cell.row, cell.col, cell.value, style)
              }
            }
          })
        }
      } else if (rowColOp.type === 'insert_col') {
        replayRowColOp({ type: 'delete_col', index: rowColOp.index })
      } else if (rowColOp.type === 'delete_col') {
        replayRowColOp({ type: 'insert_col', index: rowColOp.index })
        // 需要恢复被删除列的单元格数据
        if (rowColOp.data) {
          const ws = reduxStore.getState().workSheet
          batch(() => {
            for (const [, cell] of Object.entries(rowColOp.data ?? {})) {
              if (cell) {
                const style = cell.styleId ? (ws.styles[cell.styleId] ?? {}) : undefined
                rawCommit(cell.row, cell.col, cell.value, style)
              }
            }
          })
        }
      }
    }
  }, [replayCellOp, replayRowColOp, replayBatch, rawCommit, reduxStore])

  const redo = useCallback(() => {
    const op = historyRef.current.popRedo()
    if (!op) return

    if ('after' in op && 'before' in op) {
      // 单个单元格操作
      const cellOp = op as CellOperation
      replayCellOp(cellOp, cellOp.after)
    } else if ('type' in op && op.type === 'batch_cell') {
      // 批量单元格操作 — 按快照分组走 batch_set_cell 回放，避免逐格打爆 WS
      const batchOp = op as BatchCellOperation
      replayBatch(batchOp.operations, (cellOp) => cellOp.after)
    } else if ('type' in op) {
      // 行列操作
      replayRowColOp(op as RowColOperation)
    }
  }, [replayCellOp, replayRowColOp, replayBatch])

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

  return { commitWithHistory, commitBatchWithHistory, executeRowColWithHistory, undo, redo }
}
