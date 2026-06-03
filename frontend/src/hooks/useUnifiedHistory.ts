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
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'
import type { RootState } from '@/spreadsheet/store'
import type { Style } from '@/spreadsheet/model/types'
import type { Cell } from '@/spreadsheet/model/types'
import type { CommitCellFn, CommitRangeFn } from '@/hooks/useSpreadsheetInteraction'
import type { BatchCommitFn } from '@/hooks/useCommitCell'
import type { CollabClient } from '@/spreadsheet/collab/CollabClient'

export interface UseUnifiedHistoryResult {
  /** 包装后的提交函数：执行写入并记录历史。替代直接调用 onCommitCell。 */
  commitWithHistory: CommitCellFn
  /** 批量提交函数：多个单元格的修改作为一个原子操作 */
  commitBatchWithHistory: BatchCommitFn
  /**
   * 区域批量写入函数（粘贴用）：走 set_range_values 写入并记录历史，作为一个原子操作。
   * cells 形态与协议一致（逐格 value/styleId）；撤回时还原各格 before 快照。
   */
  commitRangeWithHistory: CommitRangeFn
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
 * @param onCommitRange 区域批量写入（走 WS set_range_values）。批量撤回/重做优先用它，
 *   一条消息原子还原 N 格各自不同的值/样式；缺省时退回按快照分组的 batch 回放。
 */
export function useUnifiedHistory(
  onCommitCell?: CommitCellFn,
  onCommitBatch?: BatchCommitFn,
  collabClient?: CollabClient,
  onCommitRange?: CommitRangeFn
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
  const rangeCommitRef = useRef(onCommitRange)
  useEffect(() => {
    commitRef.current = onCommitCell
  }, [onCommitCell])
  useEffect(() => {
    batchCommitRef.current = onCommitBatch
  }, [onCommitBatch])
  useEffect(() => {
    rangeCommitRef.current = onCommitRange
  }, [onCommitRange])

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
   *
   * 优先走 set_range_values（onCommitRange）：逐格不同的 value/style 用样式池化编码进
   * 一条消息，后端一次拿锁、原子应用整批、发一个 seq。无论多少格、内容是否相同，永远
   * 一条消息、一次锁 —— 替代旧的「按目标快照分组 + 多条 batch_set_cell + 60ms 串行发送」
   * 兜底（见 SetRangeValues 协议提案 §7.4）。store 由协同广播 onRangeValuesUpdated 原子回写。
   *
   * 无 range 通道时（onCommitRange 缺省，如离线/单测）退回逐格 rawCommit，一次 React batch
   * 内提交，保证回放本身正确、不依赖协同。
   */
  const replayBatch = useCallback(
    (operations: CellOperation[], pick: (op: CellOperation) => CellSnapshot) => {
      if (operations.length === 0) return

      const commitRange = rangeCommitRef.current
      if (!commitRange) {
        // 兜底：无 set_range_values 通道，逐格本地提交
        batch(() => {
          for (const op of operations) {
            const snap = pick(op)
            rawCommit(op.row, op.col, snap.value, snap.style)
          }
        })
        return
      }

      // 样式池化：相同样式只存一份，cell 用 styleId 引用；无样式则显式 styleId=null 清空，
      // 保证撤回能把「原来有样式、现在应无样式」的格子还原干净。
      const stylesPool: Record<string, Style> = {}
      const cells = operations.map((op) => {
        const snap = pick(op)
        const styleId = findOrCreateStyleId(stylesPool, snap.style)
        return {
          row: op.row,
          col: op.col,
          value: snap.value,
          styleId: styleId ?? null,
        }
      })

      // 一条 set_range_values 原子还原整批
      commitRange(cells, stylesPool)
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

  // 区域批量写入入口（粘贴）：走 set_range_values 一次原子写入并记录历史。
  // cells 携带逐格 value/styleId（引用 styles 池）；这里把它解引用成快照后入栈，
  // 撤回时复用 replayBatch（同样走 set_range_values）把各格还原成 before。
  const commitRangeWithHistory = useCallback<CommitRangeFn>(
    (cells, styles) => {
      if (cells.length === 0) return

      const operations: CellOperation[] = cells.map((cell) => {
        const before = readSnapshot(cell.row, cell.col)
        // 解引用 styleId：null=清空(空样式)，undefined=保留原样式，命中池=对应样式
        let afterStyle: Style
        if (cell.styleId === null) {
          afterStyle = {}
        } else if (cell.styleId !== undefined) {
          afterStyle = (styles?.[cell.styleId] as Style | undefined) ?? {}
        } else {
          afterStyle = before.style
        }
        // value 缺省时保留原值
        const afterValue = cell.value !== undefined ? cell.value : before.value
        const after: CellSnapshot = { value: afterValue, style: afterStyle }
        return { row: cell.row, col: cell.col, before, after }
      })

      // 实际写入：优先 set_range_values，缺省时退回逐格本地提交
      const commitRange = rangeCommitRef.current
      if (commitRange) {
        commitRange(cells, styles)
      } else {
        batch(() => {
          for (const op of operations) {
            rawCommit(op.row, op.col, op.after.value, op.after.style)
          }
        })
      }

      if (operations.length > 0) {
        historyRef.current.push({ type: 'batch_cell', operations })
      }
    },
    [readSnapshot, rawCommit]
  )
  const executeRowColWithHistory = useCallback(
    (action: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col', index: number) => {
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

  return {
    commitWithHistory,
    commitBatchWithHistory,
    commitRangeWithHistory,
    executeRowColWithHistory,
    undo,
    redo,
  }
}
