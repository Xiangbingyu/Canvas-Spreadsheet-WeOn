// Interaction Engine 实现
// 负责：鼠标命中检测、单元格选区、键盘导航、把交互事件转给 SpreadsheetPage

import type { SelectionRange, RenderConfig, WorksheetConfig } from '../model/types'
import type {
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

// ==================== 交互引擎 ====================

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
  private worksheetConfig: WorksheetConfig
  private scrollX: number = 0
  private scrollY: number = 0

  constructor(
    config: Required<RenderConfig>,
    worksheetConfig: WorksheetConfig,
    callbacks: EngineCallbacks
  ) {
    this.config = config
    this.worksheetConfig = worksheetConfig
    this.callbacks = callbacks
    this.state = {
      selection: { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } },
      isEditing: false,
      isSelecting: false,
      isDragging: false,
    }
  }

  /** 更新回调（用于回调依赖最新闭包数据时） */
  setCallbacks(callbacks: EngineCallbacks) {
    this.callbacks = callbacks
  }

  /** 更新 worksheet 配置（行高/列宽变化时） */
  setWorksheetConfig(worksheetConfig: WorksheetConfig) {
    this.worksheetConfig = worksheetConfig
  }

  /** GrideCanvas 滚动时同步给 engine，命中检测时用 */
  setScroll(scrollX: number, scrollY: number) {
    this.scrollX = scrollX
    this.scrollY = scrollY
  }

  /** 按 (dr, dc) 移动选区，行列各自 clamp。extend=true 表示扩展终点（Shift 模式）。 */
  moveSelection(dr: number, dc: number, extend: boolean = false) {
    const { selection } = this.state
    const rowCount = this.worksheetConfig.rowCount
    const colCount = this.worksheetConfig.colCount
    const clampRow = (r: number) => Math.max(1, Math.min(r, rowCount))
    const clampCol = (c: number) => Math.max(1, Math.min(c, colCount))
    const newEnd = {
      row: clampRow(selection.end.row + dr),
      col: clampCol(selection.end.col + dc),
    }
    if (extend) {
      this.updateSelection({ start: selection.start, end: newEnd }, 'keyboard')
    } else {
      this.updateSelection({ start: newEnd, end: newEnd }, 'keyboard')
    }
  }

  // 选区规范化（确保 start <= end）
  private normalizeSelection(
    start: { row: number; col: number },
    end: { row: number; col: number }
  ): SelectionRange {
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

  // 处理 Canvas 鼠标按下：起始位置 + shift 决定是新选区还是扩展终点
  handleCanvasPointerDown(event: {
    currentTarget: HTMLCanvasElement
    clientX: number
    clientY: number
    shiftKey?: boolean
  }) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const coord = hitTest(x, y, this.config, this.scrollX, this.scrollY, this.worksheetConfig)
    if (!coord) {
      this.callbacks.onCanvasClick?.({ event: event as unknown as React.MouseEvent })
      return
    }

    if (event.shiftKey) {
      // shift+click：扩展选区终点
      this.state.isSelecting = true
      this.state.isDragging = false
      this.updateSelection(this.normalizeSelection(this.state.selection.start, coord), 'mouse')
    } else {
      // 普通点击：新选区起点
      this.state.isSelecting = true
      this.state.isDragging = false
      this.state.selectionStart = { ...coord }
      this.updateSelection({ start: coord, end: coord }, 'mouse')
      this.callbacks.onCellClick?.({ coord, event: event as unknown as React.MouseEvent })
    }
  }

  /** 鼠标拖拽中：扩展选区 */
  handleCanvasPointerMove(event: {
    currentTarget: HTMLCanvasElement | null
    clientX: number
    clientY: number
  }) {
    if (!this.state.isSelecting) return
    const target = event.currentTarget
    if (!target) return
    const rect = target.getBoundingClientRect()
    // 拖拽到 canvas 外的位置也要 clamp 到合法范围
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width - 1))
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height - 1))
    const coord = hitTest(x, y, this.config, this.scrollX, this.scrollY, this.worksheetConfig)
    if (!coord) return

    const start = this.state.selectionStart ?? this.state.selection.start
    // 起始与当前不同，认为是真正的拖拽
    if (coord.row !== start.row || coord.col !== start.col) {
      this.state.isDragging = true
    }
    this.updateSelection(this.normalizeSelection(start, coord), 'mouse')
  }

  /** 鼠标抬起：结束拖拽 */
  handleCanvasPointerUp() {
    this.state.isSelecting = false
    this.state.isDragging = false
    this.state.selectionStart = undefined
  }

  /** 处理 Canvas 双击：命中后进入编辑态 */
  handleCanvasDoubleClick(
    event: {
      currentTarget: HTMLCanvasElement
      clientX: number
      clientY: number
    } & Partial<React.MouseEvent>
  ) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const coord = hitTest(x, y, this.config, this.scrollX, this.scrollY, this.worksheetConfig)
    if (!coord) return

    this.handleCellDoubleClick({ coord, event: event as React.MouseEvent })
  }

  // 旧的 handleCanvasClick 保留为兼容入口，转发到 PointerDown
  handleCanvasClick(
    event: {
      currentTarget: HTMLCanvasElement
      clientX: number
      clientY: number
    } & Partial<React.MouseEvent>
  ) {
    this.handleCanvasPointerDown({
      currentTarget: event.currentTarget,
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: (event as React.MouseEvent).shiftKey,
    })
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
    // 编辑态由 SpreadsheetPage 维护，engine 只负责通知
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
      const newSelection = this.normalizeSelection(this.state.selectionStart, args.coord)
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
      const finalSelection = this.normalizeSelection(this.state.selectionStart, args.coord)
      this.updateSelection(finalSelection, 'mouse')
    }

    this.state.isSelecting = false
    this.state.isDragging = false
    this.state.selectionStart = undefined

    if (this.callbacks.onCellMouseUp) {
      this.callbacks.onCellMouseUp(args)
    }
  }

  // 处理键盘事件（非编辑态）
  // 编辑态时 SpreadsheetPage 不会调用本方法，所以这里不再判断 isEditing
  handleKeyboard(event: KeyboardEvent) {
    const { selection } = this.state

    const rowCount = this.worksheetConfig.rowCount
    const colCount = this.worksheetConfig.colCount

    const clampRow = (r: number) => Math.max(1, Math.min(r, rowCount))
    const clampCol = (c: number) => Math.max(1, Math.min(c, colCount))

    // 方向键（含 Shift 扩展选区）
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const newEnd = { ...selection.end }
      switch (event.key) {
        case 'ArrowUp':
          newEnd.row = clampRow(newEnd.row - 1)
          break
        case 'ArrowDown':
          newEnd.row = clampRow(newEnd.row + 1)
          break
        case 'ArrowLeft':
          newEnd.col = clampCol(newEnd.col - 1)
          break
        case 'ArrowRight':
          newEnd.col = clampCol(newEnd.col + 1)
          break
      }
      if (event.shiftKey) {
        this.updateSelection({ start: selection.start, end: newEnd }, 'keyboard')
      } else {
        this.updateSelection({ start: newEnd, end: newEnd }, 'keyboard')
      }
      event.preventDefault()
      return
    }

    // Tab：向右移动；Shift+Tab：向左
    if (event.key === 'Tab') {
      const newCol = clampCol(selection.end.col + (event.shiftKey ? -1 : 1))
      const newCoord = { row: selection.end.row, col: newCol }
      this.updateSelection({ start: newCoord, end: newCoord }, 'keyboard')
      event.preventDefault()
      return
    }

    // 其他键（Enter、F2、字母数字等）交给外部决定是否进入编辑态
    if (this.callbacks.onKeyboard) {
      this.callbacks.onKeyboard({ event, currentSelection: selection })
    }
  }

  // ========== 编辑相关 ==========

  // 开始编辑
  startEdit(coord: { row: number; col: number }) {
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

  getEditingCoord(): { row: number; col: number } | undefined {
    return this.state.editingCoord
  }
}

// 计算单元格的像素坐标
export function getCellRect(
  coord: { row: number; col: number },
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

// 命中检测：将鼠标的 canvas 坐标转换为 1-based 单元格坐标
// 与 gridRenderer / viewport.getCellRect 保持一致：
//   x = headerWidth + (col-1)*colWidth - scrollX
//   y = headerHeight + (row-1)*rowHeight - scrollY
export function hitTest(
  mouseX: number,
  mouseY: number,
  config: Required<RenderConfig>,
  scrollX: number = 0,
  scrollY: number = 0,
  worksheetConfig?: WorksheetConfig
): { row: number; col: number } | null {
  const headerWidth = config.headerWidth
  const headerHeight = config.headerHeight
  // 优先使用 worksheet 当前的行高列宽（导入 Excel 后会变）
  const colWidth = worksheetConfig?.defaultColWidth ?? config.colWidth
  const rowHeight = worksheetConfig?.defaultRowHeight ?? config.rowHeight

  if (mouseX < headerWidth || mouseY < headerHeight) {
    return null
  }

  const sheetX = scrollX + (mouseX - headerWidth)
  const sheetY = scrollY + (mouseY - headerHeight)
  if (sheetX < 0 || sheetY < 0) {
    return null
  }

  const col = Math.floor(sheetX / colWidth) + 1
  const row = Math.floor(sheetY / rowHeight) + 1

  const rowCount = worksheetConfig?.rowCount
  const colCount = worksheetConfig?.colCount
  if (rowCount !== undefined && (row < 1 || row > rowCount)) return null
  if (colCount !== undefined && (col < 1 || col > colCount)) return null

  return { row, col }
}

// Interaction Engine 负责管理状态和业务逻辑
interface InteractionEngineState {
  selection: SelectionRange
  isEditing: boolean
  editingCoord?: { row: number; col: number }
  isSelecting: boolean
  selectionStart?: { row: number; col: number }
  isDragging: boolean // 区分点击和拖拽
}
