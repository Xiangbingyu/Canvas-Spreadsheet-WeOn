// Canvas 渲染组件（预留框架）
// 本文件由 Canvas 渲染同学实现，此处为框架和类型定义

import type { FC, CanvasHTMLAttributes } from 'react'
import type { CellCoord, SelectionRange, RenderConfig } from '../../spreadsheet/model/types'
import type { InteractionCallbacks } from './interaction'

export interface CanvasSpreadsheetProps {
  rowCount: number
  colCount: number
  cells: Record<string, { value: string; styleId?: string }>
  selection: SelectionRange
  editingCell?: CellCoord | null
  config?: RenderConfig
  callbacks: InteractionCallbacks
  className?: string
  style?: React.CSSProperties
}

export const CanvasSpreadsheet: FC<CanvasSpreadsheetProps> = (props) => {
  // Canvas 渲染实现
  // 需要调用 callbacks 中的事件回调

  return (
    <canvas
      width={props.config?.colWidth! * props.colCount}
      height={props.config?.rowHeight! * props.rowCount}
      className={props.className}
      style={props.style}
    />
  )
}

CanvasSpreadsheet.displayName = 'CanvasSpreadsheet'
