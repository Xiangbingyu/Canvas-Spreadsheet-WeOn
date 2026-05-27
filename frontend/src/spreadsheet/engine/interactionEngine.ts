// Interaction Engine 实现
// 负责处理所有编辑交互相关的逻辑

import type { CellCoord, SelectionRange, RenderConfig } from '../model/types'
import type {
  InteractionCallbacks,
  CanvasClickEventArgs,
  CellClickEventArgs,
  CellDoubleClickEventArgs,
  CellMouseDownEventArgs,
  CellMouseMoveEventArgs,
  CellMouseUpEventArgs,
  CellEditSubmitEventArgs,
  CellEditCancelEventArgs,
  KeyboardEventArgs,
  SelectionChangeEventArgs,
  CellInputChangeEventArgs,
  CellCompositionEventArgs,
} from '../interaction/interaction'

// 计算单元格的像素坐标
export function getCellRect(
  coord: CellCoord,
  config: Required<RenderConfig>
): { x: number; y: number; width: number; height: number } {
  const { colWidth, rowHeight, headerWidth, headerHeight } = config
  return {
    x: headerWidth + coord.col * colWidth,
    y: headerHeight + coord.row * rowHeight,
    width: colWidth,
    height: rowHeight,
  }
}

// 命中检测：将像素坐标转换为单元格坐标
export function hitTest(
  mouseX: number,
  mouseY: number,
  config: Required<RenderConfig>
): CellCoord | null {
  const { colWidth, rowHeight, headerWidth, headerHeight } = config

  const relativeX = mouseX - headerWidth
  const relativeY = mouseY - headerHeight

  if (relativeX < 0 || relativeY < 0) {
    return null
  }

  const col = Math.floor(relativeX / colWidth)
  const row = Math.floor(relativeY / rowHeight)

  if (col < 0 || row < 0) {
    return null
  }

  return { row, col }
}

// Interaction Engine 负责管理状态和业务逻辑
interface InteractionEngineState {
  selection: SelectionRange
  isEditing: boolean
  editingCoord?: CellCoord
  isSelecting: boolean
  selectionStart?: CellCoord
  isDragging: boolean // 区分点击和拖拽
}

// 仅包含回调接口，不包含 React 依赖
interface EngineCallbacks {
  onCellClick?: (args: CellClickEventArgs) => void
  onCellDoubleClick?: (args: CellDoubleClickEventArgs) => void
  onCellMouseDown?: (args: CellMouseDownEventArgs) => void
  onCellMouseMove?: (args: CellMouseMoveEventArgs) => void
  onCellMouseUp?: (args: CellMouseUpEventArgs) => void
  onCanvasClick?: (args: CanvasClickEventArgs) => void
  onCellEditSubmit?: (args: CellEditSubmitEventArgs) => void
  onCellEditCancel?: (args: CellEditCancelEventArgs) => void
  onKeyboard?: (args: KeyboardEventArgs) => void
  onSelectionChange?: (args: SelectionChangeEventArgs) => void
  onCellInputChange?: (args: CellInputChangeEventArgs) => void
  onCellCompositionStart?: (args: CellCompositionEventArgs) => void
  onCellCompositionEnd?: (args: CellCompositionEventArgs) => void
}

export class InteractionEngine {
  private state: InteractionEngineState
  private callbacks: EngineCallbacks
  private config: Required<RenderConfig>

  constructor(config: Required<RenderConfig>, callbacks: EngineCallbacks) {
    this.config = config
    this.callbacks = callbacks
    this.state = {
      selection: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      isEditing: false,
      isSelecting: false,
      isDragging: false,
    }
  }

  // 选区规范化（确保 start <= end）
  private normalizeSelection(start: CellCoord, end: CellCoord): SelectionRange {
    return {
      start: {
        row: Math.min(start.row, end.row),
        col: Math.min(start.col, end.col),
      },
      end: {
        row: Math.max(start.row, end.row),
        col: Math.max(start.col, end.col),
      },
    }
  }

  // 更新选区并触发回调
  private updateSelection(
    newSelection: SelectionRange,
    reason: SelectionChangeEventArgs['reason'] = 'mouse'
  ) {
    this.state.selection = newSelection

    if (this.callbacks.onSelectionChange) {
      this.callbacks.onSelectionChange({
        newSelection,
        reason,
      })
    }
  }

  // ========== 事件处理 ==========

  // 处理 Canvas 鼠标点击
  handleCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const coord = hitTest(x, y, this.config)

    if (coord) {
      this.handleCellClick({ coord, event })
    } else {
      if (this.callbacks.onCanvasClick) {
        this.callbacks.onCanvasClick({ event })
      }
    }
  }

  // 处理单元格点击
  handleCellClick(args: CellClickEventArgs) {
    // 单击选中单元格
    const newSelection = {
      start: args.coord,
      end: args.coord,
    }
    this.updateSelection(newSelection, 'mouse')

    // 触发原始回调
    if (this.callbacks.onCellClick) {
      this.callbacks.onCellClick(args)
    }
  }

  // 处理单元格双击
  handleCellDoubleClick(args: CellDoubleClickEventArgs) {
    // 进入编辑态
    this.state.isEditing = true
    this.state.editingCoord = args.coord

    if (this.callbacks.onCellDoubleClick) {
      this.callbacks.onCellDoubleClick(args)
    }
  }

  // 处理鼠标按下（开始拖拽选区）
  handleCellMouseDown(args: CellMouseDownEventArgs) {
    this.state.isSelecting = true
    this.state.isDragging = true
    this.state.selectionStart = { ...args.coord }

    // 保存选区起始位置
    if (this.callbacks.onCellMouseDown) {
      this.callbacks.onCellMouseDown(args)
    }
  }

  // 处理鼠标移动
  handleCellMouseMove(args: CellMouseMoveEventArgs) {
    if (this.state.isSelecting && this.state.selectionStart) {
      // 拖拽选区
      const newSelection = this.normalizeSelection(
        this.state.selectionStart,
        args.coord
      )
      this.updateSelection(newSelection, 'mouse')
    }

    if (this.callbacks.onCellMouseMove) {
      this.callbacks.onCellMouseMove(args)
    }
  }

  // 处理鼠标抬起
  handleCellMouseUp(args: CellMouseUpEventArgs) {
    // 保存最终的选区
    if (this.state.isSelecting && this.state.selectionStart) {
      const finalSelection = this.normalizeSelection(
        this.state.selectionStart,
        args.coord
      )
      this.updateSelection(finalSelection, 'mouse')
    }

    this.state.isSelecting = false
    this.state.isDragging = false
    this.state.selectionStart = undefined

    if (this.callbacks.onCellMouseUp) {
      this.callbacks.onCellMouseUp(args)
    }
  }

  // 处理键盘事件
  handleKeyboard(event: KeyboardEvent) {
    const { selection, isEditing } = this.state

    // 拦截组合键
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      // 处理方向键 + Shift：扩展选区
      if (event.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        let newEnd: CellCoord = { ...selection.end }

        switch (event.key) {
          case 'ArrowUp':
            newEnd.row = Math.max(0, newEnd.row - 1)
            break
          case 'ArrowDown':
            newEnd.row += 1
            break
          case 'ArrowLeft':
            newEnd.col = Math.max(0, newEnd.col - 1)
            break
          case 'ArrowRight':
            newEnd.col += 1
            break
        }

        this.updateSelection(
          { start: selection.start, end: newEnd },
          'keyboard'
        )
        event.preventDefault()
        return
      }
    }

    // 处理 Enter：提交编辑或向下移动
    if (event.key === 'Enter') {
      if (isEditing) {
        // 在 textarea 中处理提交
        event.preventDefault()
        return
      } else {
        // 向下移动选区
        event.preventDefault()
        const newSelection = {
          start: { row: (selection.end.row + 1) % this.config.rowCount, col: selection.start.col },
          end: { row: (selection.end.row + 1) % this.config.rowCount, col: selection.end.col },
        }
        this.updateSelection(newSelection, 'keyboard')
        return
      }
    }

    // 处理 ESC：取消编辑
    if (event.key === 'Escape') {
      if (isEditing && this.state.editingCoord) {
        if (this.callbacks.onCellEditCancel) {
          this.callbacks.onCellEditCancel({
            coord: this.state.editingCoord,
          })
        }
        this.state.isEditing = false
        this.state.editingCoord = undefined
      }
      event.preventDefault()
      return
    }

    // 处理 Tab：切换到下一个单元格
    if (event.key === 'Tab') {
      const newCol = (selection.end.col + (event.shiftKey ? -1 : 1) + this.config.colCount) % this.config.colCount
      const newRow = event.shiftKey && newCol === selection.end.col ? (selection.end.row - 1 + this.config.rowCount) % this.config.rowCount : selection.end.row

      this.updateSelection(
        {
          start: { row: newRow, col: newCol },
          end: { row: newRow, col: newCol },
        },
        'keyboard'
      )
      event.preventDefault()
      return
    }

    // 处理方向键：移动选区
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      let newCoord: CellCoord = { ...selection.end }

      switch (event.key) {
        case 'ArrowUp':
          newCoord.row = Math.max(0, newCoord.row - 1)
          break
        case 'ArrowDown':
          newCoord.row = Math.min(newCoord.row + 1, this.config.rowCount - 1)
          break
        case 'ArrowLeft':
          newCoord.col = Math.max(0, newCoord.col - 1)
          break
        case 'ArrowRight':
          newCoord.col = Math.min(newCoord.col + 1, this.config.colCount - 1)
          break
      }

      if (!event.shiftKey) {
        // 单击模式：移动起始位置
        this.updateSelection(
          { start: newCoord, end: newCoord },
          'keyboard'
        )
      } else {
        // Shift 模式：只移动结束位置
        this.updateSelection(
          { start: selection.start, end: newCoord },
          'keyboard'
        )
      }
      event.preventDefault()
      return
    }

    // 触发原始键盘回调
    if (this.callbacks.onKeyboard) {
      this.callbacks.onKeyboard({
        event,
        currentSelection: selection,
      })
    }
  }

  // ========== 编辑相关 ==========

  // 开始编辑
  startEdit(coord: CellCoord) {
    this.state.isEditing = true
    this.state.editingCoord = coord
  }

  // 提交编辑
  submitEdit(value: string) {
    if (!this.state.editingCoord) return

    if (this.callbacks.onCellEditSubmit) {
      this.callbacks.onCellEditSubmit({
        coord: this.state.editingCoord,
        value,
      })
    }

    this.state.isEditing = false
    this.state.editingCoord = undefined
  }

  // 取消编辑
  cancelEdit() {
    if (!this.state.editingCoord) return

    if (this.callbacks.onCellEditCancel) {
      this.callbacks.onCellEditCancel({
        coord: this.state.editingCoord,
      })
    }

    this.state.isEditing = false
    this.state.editingCoord = undefined
  }

  // ========== Getters ==========

  getSelection(): SelectionRange {
    return this.state.selection
  }

  isEditing(): boolean {
    return this.state.isEditing
  }

  getEditingCoord(): CellCoord | undefined {
    return this.state.editingCoord
  }
}
