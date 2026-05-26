// 中文输入法处理 - Composition Handler
// 负责处理中文输入法的 compositionstart/end 事件

import type { CellCoord } from '../../spreadsheet/model/types'
import type {
  CellCompositionEventArgs,
  CellInputChangeEventArgs,
  CellEditCompleteEventArgs,
} from './interaction'

// InteractionEngine 的接口声明（简化版）
interface InteractionEngineCallbacks {
  onCellInputChange?: (args: CellInputChangeEventArgs) => void
  onCellCompositionStart?: (args: CellCompositionEventArgs) => void
  onCellCompositionEnd?: (args: CellCompositionEventArgs) => void
  onCellEditSubmit?: (args: { coord: CellCoord; value: string }) => void
}

interface SelectionRange {
  start: CellCoord
  end: CellCoord
}

interface InteractionEngine {
  callbacks: InteractionEngineCallbacks
  rowCount: number
  colCount: number
  selection: SelectionRange
  isEditing: boolean
  editingCoord?: CellCoord
}

export class CompositionHandler {
  private engine: InteractionEngine
  private isComposing: boolean = false
  private currentEditingCoord?: CellCoord
  private tempValue: string = ''

  constructor(engine: InteractionEngine) {
    this.engine = engine
  }

  // 开始 composition（中文输入法开始）
  startComposition(coord: CellCoord, event: CompositionEvent) {
    this.isComposing = true
    this.currentEditingCoord = coord
    this.tempValue = ''

    const args: CellCompositionEventArgs = {
      coord,
      event,
    }

    if (this.engine.callbacks.onCellCompositionStart) {
      this.engine.callbacks.onCellCompositionStart(args)
    }
  }

  // composition 期间的文字变化
  onCompositionChange(value: string) {
    if (!this.currentEditingCoord) return

    this.tempValue = value

    const args: CellInputChangeEventArgs = {
      coord: this.currentEditingCoord,
      value,
    }

    if (this.engine.callbacks.onCellInputChange) {
      this.engine.callbacks.onCellInputChange(args)
    }
  }

  // 结束 composition（中文输入法完成）
  endComposition(event: CompositionEvent) {
    if (!this.currentEditingCoord) return

    this.isComposing = false

    // 提交最终文本
    const finalValue = event.data || this.tempValue

    // 触发编辑提交回调
    if (this.engine.callbacks.onCellEditSubmit) {
      this.engine.callbacks.onCellEditSubmit({
        coord: this.currentEditingCoord,
        value: finalValue,
      })
    }

    // 触发 composition 结束回调
    if (this.engine.callbacks.onCellCompositionEnd) {
      this.engine.callbacks.onCellCompositionEnd({
        coord: this.currentEditingCoord,
        event,
      })
    }

    // 清理状态
    this.currentEditingCoord = undefined
    this.tempValue = ''
  }

  // 检查是否正在 composition 中
  isCurrentlyComposing(): boolean {
    return this.isComposing
  }

  // 获取当前 composition 的临时值
  getTempValue(): string {
    return this.tempValue
  }
}
