// Interaction Engine 接口定义
// 本模块定义 Canvas 渲染组件与交互逻辑之间的回调接口

import type { CellCoord, SelectionRange } from '../model/types'

// 单元格点击事件
export interface CellClickEventArgs {
  coord: CellCoord
  event: MouseEvent
}

// 单元格双击事件
export interface CellDoubleClickEventArgs {
  coord: CellCoord
  event: MouseEvent
}

// 单元格鼠标按下（开始拖拽选区）
export interface CellMouseDownEventArgs {
  coord: CellCoord
  event: MouseEvent
}

// 单元格鼠标移动
export interface CellMouseMoveEventArgs {
  coord: CellCoord
  event: MouseEvent
}

// 单元格鼠标抬起
export interface CellMouseUpEventArgs {
  coord: CellCoord
  event: MouseEvent
}

// Canvas 整体点击（点击空白区域）
export interface CanvasClickEventArgs {
  event: MouseEvent
}

// 编辑提交事件
export interface CellEditSubmitEventArgs {
  coord: CellCoord
  value: string
}

// 编辑取消事件
export interface CellEditCancelEventArgs {
  coord: CellCoord
}

// 输入框文字变化（用于 composition 事件）
export interface CellInputChangeEventArgs {
  coord: CellCoord
  value: string
}

// 编辑完成事件（composition end 后提交）
export interface CellEditCompleteEventArgs {
  coord: CellCoord
  value: string
}

// 键盘事件
export interface KeyboardEventArgs {
  event: KeyboardEvent
  currentSelection: SelectionRange
}

// Composition 事件
export interface CellCompositionEventArgs {
  coord: CellCoord
  event: CompositionEvent
}

// 选区变化事件
export interface SelectionChangeEventArgs {
  newSelection: SelectionRange
  reason: 'mouse' | 'keyboard' | 'api'
}

// Canvas 渲染组件需要实现的回调接口
// Canvas 同学需要在其实现中调用这些回调
export interface InteractionCallbacks {
  // 点击单元格
  onCellClick?: (args: CellClickEventArgs) => void

  // 双击单元格（进入编辑态）
  onCellDoubleClick?: (args: CellDoubleClickEventArgs) => void

  // 鼠标按下（可用于开始选区拖拽）
  onCellMouseDown?: (args: CellMouseDownEventArgs) => void

  // 鼠标移动
  onCellMouseMove?: (args: CellMouseMoveEventArgs) => void

  // 鼠标抬起
  onCellMouseUp?: (args: CellMouseUpEventArgs) => void

  // 点击 Canvas 空白区域
  onCanvasClick?: (args: CanvasClickEventArgs) => void

  // 编辑提交（textarea 失焦或按 Enter）
  onCellEditSubmit?: (args: CellEditSubmitEventArgs) => void

  // 编辑取消（按 ESC）
  onCellEditCancel?: (args: CellEditCancelEventArgs) => void

  // 键盘事件
  onKeyboard?: (args: KeyboardEventArgs) => void

  // 选区变化
  onSelectionChange?: (args: SelectionChangeEventArgs) => void

  // 输入框文字变化（composition 期间）
  onCellInputChange?: (args: CellInputChangeEventArgs) => void

  // Composition 开始（中文输入法开始）
  onCellCompositionStart?: (args: CellCompositionEventArgs) => void

  // Composition 结束（中文输入法完成，提交编辑）
  onCellCompositionEnd?: (args: CellCompositionEventArgs) => void
}

// Canvas 渲染组件的 Props 接口
export interface CanvasSpreadsheetProps {
  // 表格数据
  rowCount: number
  colCount: number

  // 单元格数据映射 (key: "row:col", value: Cell)
  cells: Record<string, { value: string; styleId?: string }>

  // 当前选区
  selection: SelectionRange

  // 当前编辑中的单元格（undefined 表示不在编辑态）
  editingCell?: CellCoord | null

  // 渲染配置
  config?: {
    rowHeight?: number
    colWidth?: number
    headerHeight?: number
    headerWidth?: number
  }

  // 回调接口
  callbacks: InteractionCallbacks
}

// Interaction Engine 负责处理以下逻辑：
// 1. 鼠标命中检测（点击 Canvas 定位到单元格行列）
// 2. 双击进入编辑态
// 3. 中文输入法处理（compositionstart/end 事件）
// 4. 键盘事件（Enter 提交、ESC 取消、Tab 切换、方向键移动选区）
// 5. 单元格选区管理（单击选中、Shift 拖拽多选）
