// Interaction Engine：鼠标命中、选区、键盘导航（无 React / Canvas 绘制依赖）

import type { SelectionRange } from '../model/selection'
import type { RenderConfig, WorksheetConfig } from '../model/renderConfig'
import type { Viewport } from '../render/viewport'
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
} from './interaction'

export interface ViewportController {
  scrollBy(deltaX: number, deltaY: number): void
  getViewport(): Viewport
}

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
  onAutoScroll?: (args: { row: number; col: number }) => void
}

export class InteractionEngine {
  private state: InteractionEngineState
  private callbacks: EngineCallbacks
  private config: Required<RenderConfig>
  private worksheetConfig: WorksheetConfig
  private scrollX: number = 0
  private scrollY: number = 0
  private viewportController: ViewportController | null = null
  private autoScrollRafId: number | null = null
  private lastMouseX: number = 0
  private lastMouseY: number = 0
  private canvasRect: DOMRect | null = null

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

  setCallbacks(callbacks: EngineCallbacks) {
    this.callbacks = callbacks
  }

  setWorksheetConfig(worksheetConfig: WorksheetConfig) {
    this.worksheetConfig = worksheetConfig
  }

  setScroll(scrollX: number, scrollY: number) {
    this.scrollX = scrollX
    this.scrollY = scrollY
  }

  setViewportController(controller: ViewportController) {
    this.viewportController = controller
  }

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

  /**
   * 点击表头：整行 / 整列 / 全选。
   * 产出对应的矩形范围并走 onSelectionChange，active cell 落在该行/列的首格。
   */
  selectHeader(hit: HeaderHit) {
    const rowCount = this.worksheetConfig.rowCount
    const colCount = this.worksheetConfig.colCount
    let range: SelectionRange
    switch (hit.type) {
      case 'row':
        // 整行：该行第 1 列 → 最后一列
        range = { start: { row: hit.index, col: 1 }, end: { row: hit.index, col: colCount } }
        break
      case 'col':
        // 整列：第 1 行 → 最后一行
        range = { start: { row: 1, col: hit.index }, end: { row: rowCount, col: hit.index } }
        break
      case 'corner':
        // 全选
        range = { start: { row: 1, col: 1 }, end: { row: rowCount, col: colCount } }
        break
    }
    this.updateSelection(range, 'mouse')
  }

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

  private updateSelection(
    newSelection: SelectionRange,
    reason: SelectionChangeEventArgs['reason'] = 'mouse'
  ) {
    this.state.selection = newSelection
    this.callbacks.onSelectionChange?.({ newSelection, reason })
    // 触发自动滚动回调，让 GrideCanvas 处理滚动
    this.callbacks.onAutoScroll?.({ row: newSelection.end.row, col: newSelection.end.col })
  }

  handleCanvasPointerDown(event: {
    currentTarget: HTMLCanvasElement
    clientX: number
    clientY: number
    shiftKey?: boolean
  }) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    // 先判表头：点行号选整行、点列号选整列、点左上角全选
    const headerHit = hitTestHeader(
      x,
      y,
      this.config,
      this.scrollX,
      this.scrollY,
      this.worksheetConfig
    )
    if (headerHit) {
      this.selectHeader(headerHit)
      return
    }

    const coord = hitTest(x, y, this.config, this.scrollX, this.scrollY, this.worksheetConfig)
    if (!coord) {
      this.callbacks.onCanvasClick?.({ event: event as unknown as React.MouseEvent })
      return
    }

    if (event.shiftKey) {
      console.log(
        '[interactionEngine] Shift+Click at',
        coord,
        'current selection.start:',
        this.state.selection.start
      )
      this.state.isSelecting = true
      this.state.isDragging = false
      this.state.selectionStart = this.state.selection.start
      console.log('[interactionEngine] set selectionStart to:', this.state.selectionStart)
      this.updateSelection(this.normalizeSelection(this.state.selection.start, coord), 'mouse')
    } else {
      this.state.isSelecting = true
      this.state.isDragging = false
      this.state.selectionStart = { ...coord }
      this.updateSelection({ start: coord, end: coord }, 'mouse')
      this.callbacks.onCellClick?.({ coord, event: event as unknown as React.MouseEvent })
    }
  }

  handleCanvasPointerMove(event: {
    currentTarget: HTMLCanvasElement | null
    clientX: number
    clientY: number
  }) {
    if (!this.state.isSelecting) return
    const target = event.currentTarget
    if (!target) return
    const rect = target.getBoundingClientRect()
    this.canvasRect = rect
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    this.lastMouseX = x
    this.lastMouseY = y

    // 保留原始坐标，不 clamp，用于判断是否越界
    const coord = hitTest(x, y, this.config, this.scrollX, this.scrollY, this.worksheetConfig)

    // 判断是否越出数据区（超出视口边界）
    const isOutOfBounds =
      x < this.config.headerWidth ||
      y < this.config.headerHeight ||
      x >= rect.width ||
      y >= rect.height

    if (isOutOfBounds && this.state.isSelecting) {
      // 启动自动滚动
      this.startAutoScroll()
    } else {
      // 回到界内，停止自动滚动
      this.stopAutoScroll()
    }

    if (!coord) return

    const start = this.state.selectionStart ?? this.state.selection.start
    console.log(
      '[interactionEngine] pointerMove - selectionStart:',
      this.state.selectionStart,
      'selection.start:',
      this.state.selection.start,
      'using start:',
      start,
      'current coord:',
      coord
    )
    if (coord.row !== start.row || coord.col !== start.col) {
      this.state.isDragging = true
    }
    // 不使用 normalizeSelection，直接使用 start 和 coord，保持 start 为 selectionStart
    this.updateSelection({ start, end: coord }, 'mouse')
  }

  private startAutoScroll() {
    if (this.autoScrollRafId !== null) return
    if (!this.viewportController || !this.canvasRect) return

    const autoScroll = () => {
      if (!this.viewportController || !this.canvasRect) return

      const x = this.lastMouseX
      const y = this.lastMouseY
      const rect = this.canvasRect
      const headerWidth = this.config.headerWidth
      const headerHeight = this.config.headerHeight

      let deltaX = 0
      let deltaY = 0
      const scrollSpeed = 5

      // 计算越界距离，按距离计算滚动速度
      if (x < headerWidth) {
        deltaX = -Math.max(1, (headerWidth - x) / 10) * scrollSpeed
      } else if (x >= rect.width) {
        deltaX = Math.max(1, (x - rect.width + 1) / 10) * scrollSpeed
      }

      if (y < headerHeight) {
        deltaY = -Math.max(1, (headerHeight - y) / 10) * scrollSpeed
      } else if (y >= rect.height) {
        deltaY = Math.max(1, (y - rect.height + 1) / 10) * scrollSpeed
      }

      if (deltaX !== 0 || deltaY !== 0) {
        this.viewportController.scrollBy(deltaX, deltaY)
        const viewport = this.viewportController.getViewport()
        this.setScroll(viewport.scrollX, viewport.scrollY)

        // 重新 hitTest 并更新选区
        const coord = hitTest(
          this.lastMouseX,
          this.lastMouseY,
          this.config,
          this.scrollX,
          this.scrollY,
          this.worksheetConfig
        )
        if (coord) {
          const start = this.state.selectionStart ?? this.state.selection.start
          // 不使用 normalizeSelection，直接使用 start 和 coord，保持 start 为 selectionStart
          this.updateSelection({ start, end: coord }, 'mouse')
        }
      }

      this.autoScrollRafId = requestAnimationFrame(autoScroll)
    }

    this.autoScrollRafId = requestAnimationFrame(autoScroll)
  }

  private stopAutoScroll() {
    if (this.autoScrollRafId !== null) {
      cancelAnimationFrame(this.autoScrollRafId)
      this.autoScrollRafId = null
    }
  }

  handleCanvasPointerUp() {
    console.log('[interactionEngine] pointerUp - clearing selectionStart')
    this.stopAutoScroll()
    this.state.isSelecting = false
    this.state.isDragging = false
    this.state.selectionStart = undefined
  }

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

  handleCellClick(args: CellClickEventArgs) {
    this.updateSelection({ start: args.coord, end: args.coord }, 'mouse')
    this.callbacks.onCellClick?.(args)
  }

  handleCellDoubleClick(args: CellDoubleClickEventArgs) {
    this.callbacks.onCellDoubleClick?.(args)
  }

  handleCellMouseDown(args: CellMouseDownEventArgs) {
    this.state.isSelecting = true
    this.state.isDragging = true
    this.state.selectionStart = { ...args.coord }
    this.callbacks.onCellMouseDown?.(args)
  }

  handleCellMouseMove(args: CellMouseMoveEventArgs) {
    if (this.state.isSelecting && this.state.selectionStart) {
      this.updateSelection(this.normalizeSelection(this.state.selectionStart, args.coord), 'mouse')
    }
    this.callbacks.onCellMouseMove?.(args)
  }

  handleCellMouseUp(args: CellMouseUpEventArgs) {
    if (this.state.isSelecting && this.state.selectionStart) {
      this.updateSelection(this.normalizeSelection(this.state.selectionStart, args.coord), 'mouse')
    }
    this.state.isSelecting = false
    this.state.isDragging = false
    this.state.selectionStart = undefined
    this.callbacks.onCellMouseUp?.(args)
  }

  handleKeyboard(event: KeyboardEvent) {
    const { selection } = this.state
    const rowCount = this.worksheetConfig.rowCount
    const colCount = this.worksheetConfig.colCount
    const clampRow = (r: number) => Math.max(1, Math.min(r, rowCount))
    const clampCol = (c: number) => Math.max(1, Math.min(c, colCount))

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

    if (event.key === 'Tab') {
      const newCol = clampCol(selection.end.col + (event.shiftKey ? -1 : 1))
      const newCoord = { row: selection.end.row, col: newCol }
      this.updateSelection({ start: newCoord, end: newCoord }, 'keyboard')
      event.preventDefault()
      return
    }

    this.callbacks.onKeyboard?.({ event, currentSelection: selection })
  }

  startEdit(coord: { row: number; col: number }) {
    this.state.isEditing = true
    this.state.editingCoord = coord
  }

  submitEdit(value: string) {
    if (!this.state.editingCoord) return
    this.callbacks.onCellEditSubmit?.({ coord: this.state.editingCoord, value })
    this.state.isEditing = false
    this.state.editingCoord = undefined
  }

  cancelEdit() {
    if (!this.state.editingCoord) return
    this.callbacks.onCellEditCancel?.({ coord: this.state.editingCoord })
    this.state.isEditing = false
    this.state.editingCoord = undefined
  }

  handleCompositionStart() {
    console.log('[interactionEngine] composition start')
    // 不需要 coord 和 event，直接调用回调
    if (this.callbacks.onCellCompositionStart) {
      this.callbacks.onCellCompositionStart({
        coord: { row: 0, col: 0 },
        event: new CompositionEvent('compositionstart'),
      })
    }
  }

  handleCompositionEnd() {
    console.log('[interactionEngine] composition end')
    // 不需要 coord 和 event，直接调用回调
    if (this.callbacks.onCellCompositionEnd) {
      this.callbacks.onCellCompositionEnd({
        coord: { row: 0, col: 0 },
        event: new CompositionEvent('compositionend'),
      })
    }
  }

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

interface InteractionEngineState {
  selection: SelectionRange
  isEditing: boolean
  editingCoord?: { row: number; col: number }
  isSelecting: boolean
  selectionStart?: { row: number; col: number }
  isDragging: boolean
}

/** 表头命中类型：点中行号格（整行）、列号格（整列）、还是左上角全选格 */
export type HeaderHit =
  | { type: 'row'; index: number }
  | { type: 'col'; index: number }
  | { type: 'corner' }

/**
 * 命中表头区域（行号列 / 列号行 / 左上角）。
 * 返回 1-based 索引；命中网格主体或越界返回 null。
 */
export function hitTestHeader(
  mouseX: number,
  mouseY: number,
  config: Required<RenderConfig>,
  scrollX: number = 0,
  scrollY: number = 0,
  worksheetConfig?: WorksheetConfig
): HeaderHit | null {
  const headerWidth = config.headerWidth
  const headerHeight = config.headerHeight
  const colWidth = worksheetConfig?.defaultColWidth ?? config.colWidth
  const rowHeight = worksheetConfig?.defaultRowHeight ?? config.rowHeight
  const rowCount = worksheetConfig?.rowCount
  const colCount = worksheetConfig?.colCount

  const inHeaderCol = mouseX < headerWidth // 落在左侧行号列
  const inHeaderRow = mouseY < headerHeight // 落在顶部列号行

  // 左上角全选格
  if (inHeaderCol && inHeaderRow) return { type: 'corner' }

  // 顶部列号行 → 整列
  if (inHeaderRow) {
    const sheetX = scrollX + (mouseX - headerWidth)
    if (sheetX < 0) return null
    const col = Math.floor(sheetX / colWidth) + 1
    if (colCount !== undefined && (col < 1 || col > colCount)) return null
    return { type: 'col', index: col }
  }

  // 左侧行号列 → 整行
  if (inHeaderCol) {
    const sheetY = scrollY + (mouseY - headerHeight)
    if (sheetY < 0) return null
    const row = Math.floor(sheetY / rowHeight) + 1
    if (rowCount !== undefined && (row < 1 || row > rowCount)) return null
    return { type: 'row', index: row }
  }

  return null
}
