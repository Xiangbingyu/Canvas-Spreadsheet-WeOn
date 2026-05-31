// 本地撤销/重做历史栈（纯逻辑，无 React / Canvas 依赖）
//
// 只记录「本地用户」经 commit 管道产生的单元格变更，因此 undo 只回滚自己的操作；
// 远端协同广播（cell_updated）不经此模块，天然不入栈。

import type { Style } from '@/spreadsheet/model/types'
import type { Cell } from '@/spreadsheet/model/types'

/** 单元格某一时刻的内容快照（值 + 完整样式） */
export interface CellSnapshot {
  value: string
  style: Style
}

/**
 * 一次单元格变更操作：记录变更前后的完整快照。
 * 文本变更、样式变更统一用这一种结构表达。
 */
export interface CellOperation {
  row: number
  col: number
  before: CellSnapshot
  after: CellSnapshot
}

/** 行列操作：插入/删除行或列，保存完整行/列数据用于恢复 */
export interface RowColOperation {
  type: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col'
  index: number
  data?: Record<string, Cell | undefined> // 删除时保存的完整行/列数据
}

/** 批量单元格操作：多个单元格的样式/内容修改作为一个原子操作 */
export interface BatchCellOperation {
  type: 'batch_cell'
  operations: CellOperation[]
}

/** 统一的操作类型 */
export type Operation = CellOperation | RowColOperation | BatchCellOperation

function isCellOperation(op: Operation): op is CellOperation {
  return 'before' in op && 'after' in op
}

/** 两个快照是否等价（值与样式都相同），用于过滤 no-op */
export function isSameSnapshot(a: CellSnapshot, b: CellSnapshot): boolean {
  if (a.value !== b.value) return false
  return JSON.stringify(a.style ?? {}) === JSON.stringify(b.style ?? {})
}

/**
 * Undo/Redo 双栈。
 * - push：记录新操作，清空 redo 栈（标准编辑器语义）。
 * - undo：弹出最近操作，返回它（调用方据 before 回放），并压入 redo 栈。
 * - redo：弹出最近被撤销的操作，返回它（调用方据 after 回放），并压回 undo 栈。
 */
export class HistoryStack {
  private undoStack: Operation[] = []
  private redoStack: Operation[] = []
  private readonly limit: number

  constructor(limit = 200) {
    this.limit = limit
  }

  push(op: Operation): void {
    // 过滤无变化的单元格操作，避免污染历史
    if (isCellOperation(op) && isSameSnapshot(op.before, op.after)) return
    this.undoStack.push(op)
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift()
    }
    // 新操作产生后，已撤销的分支作废
    this.redoStack = []
  }

  /** 弹出一个可撤销操作；无则返回 null */
  popUndo(): Operation | null {
    const op = this.undoStack.pop()
    if (!op) return null
    this.redoStack.push(op)
    return op
  }

  /** 弹出一个可重做操作；无则返回 null */
  popRedo(): Operation | null {
    const op = this.redoStack.pop()
    if (!op) return null
    this.undoStack.push(op)
    return op
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
