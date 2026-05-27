// Canvas 渲染组件
// 负责绘制表格网格、单元格、选区等视觉元素

import { useState, useEffect, useRef, useCallback, forwardRef } from 'react'
import type { FC, CanvasHTMLAttributes, ForwardedRef } from 'react'
import type { CellCoord, SelectionRange, RenderConfig } from '@/spreadsheet/model/types'
import type { InteractionCallbacks } from '@/spreadsheet/interaction/interaction'
import { hitTest, getCellRect } from '@/spreadsheet/engine/interactionEngine'

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

// 默认配置
const DEFAULT_CONFIG: Required<RenderConfig> = {
  rowHeight: 26,
  colWidth: 100,
  headerHeight: 24,
  headerWidth: 44,
}

const CanvasSpreadsheet: FC<CanvasSpreadsheetProps> = forwardRef(function CanvasSpreadsheet(
  {
    rowCount,
    colCount,
    cells,
    selection,
    editingCell,
    config = DEFAULT_CONFIG,
    callbacks,
    className,
    style,
  },
  ref: ForwardedRef<HTMLCanvasElement>
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

  // 计算 Canvas 尺寸
  useEffect(() => {
    const { colWidth, rowHeight, headerWidth, headerHeight } = config
    setCanvasSize({
      width: headerWidth + colCount * colWidth,
      height: headerHeight + rowCount * rowHeight,
    })
  }, [rowCount, colCount, config])

  // 暴露 canvasRef 给父组件
  useEffect(() => {
    if (ref) {
      ref.current = canvasRef.current
    }
  }, [ref])

  // 绘制 Canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { colWidth, rowHeight, headerWidth, headerHeight } = config

    // 设置 Canvas 尺寸
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height

    // 绘制背景
    ctx.fillStyle = '#f8f9fa'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 绘制列标题区域背景
    ctx.fillStyle = '#f8f9fa'
    ctx.fillRect(headerWidth, 0, canvas.width - headerWidth, headerHeight)

    // 绘制行标题区域背景
    ctx.fillStyle = '#f8f9fa'
    ctx.fillRect(0, headerHeight, headerWidth, canvas.height - headerHeight)

    // 绘制网格线
    ctx.strokeStyle = '#dadce0'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, canvas.width, canvas.height)

    // 绘制列标题
    ctx.fillStyle = '#70757a'
    ctx.font = '11px Roboto, Arial, sans-serif'
    ctx.textBaseline = 'middle'
    for (let c = 0; c < colCount; c++) {
      const x = headerWidth + c * colWidth
      const label = String.fromCharCode(65 + c)
      ctx.fillText(label, x + 4, headerHeight / 2)

      // 列标题右边框
      ctx.beginPath()
      ctx.moveTo(x + colWidth, 0)
      ctx.lineTo(x + colWidth, headerHeight)
      ctx.stroke()
    }

    // 绘制行标题
    ctx.fillStyle = '#70757a'
    for (let r = 0; r < rowCount; r++) {
      const y = headerHeight + r * rowHeight
      ctx.fillText((r + 1).toString(), headerWidth / 2, y + rowHeight / 2)

      // 行标题下边框
      ctx.beginPath()
      ctx.moveTo(0, y + rowHeight)
      ctx.lineTo(headerWidth, y + rowHeight)
      ctx.stroke()
    }

    // 绘制单元格
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const rect = getCellRect({ row: r, col: c }, config)

        // 检查是否在选区中
        const isSelected =
          r >= selection.start.row &&
          r <= selection.end.row &&
          c >= selection.start.col &&
          c <= selection.end.col

        // 单元格背景
        ctx.fillStyle = isSelected ? '#e8f0fe' : 'white'
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

        // 单元格边框
        ctx.strokeStyle = '#e0e0e0'
        ctx.lineWidth = 1
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

        // 单元格文本
        const value = cells[`${r}:${c}`]?.value || ''
        ctx.fillStyle = '#202124'
        ctx.font = '13px Roboto, Arial, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.fillText(value, rect.x + 4, rect.y + rect.height / 2)

        // 选中单元格的边框和填充柄
        if (r === selection.end.row && c === selection.end.col) {
          ctx.strokeStyle = '#1a73e8'
          ctx.lineWidth = 2
          ctx.strokeRect(rect.x - 1, rect.y - 1, rect.width + 1, rect.height + 1)

          // 填充柄（右下角小方块）
          ctx.fillStyle = '#1a73e8'
          ctx.fillRect(rect.x + rect.width - 4, rect.y + rect.height - 4, 3, 3)
        }
      }
    }

    // 绘制网格线（覆盖在单元格之上，确保清晰）
    ctx.strokeStyle = '#e0e0e0'
    ctx.lineWidth = 1

    // 垂直线
    for (let c = 0; c <= colCount; c++) {
      const x = headerWidth + c * colWidth
      ctx.beginPath()
      ctx.moveTo(x, headerHeight)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }

    // 水平线
    for (let r = 0; r <= rowCount; r++) {
      const y = headerHeight + r * rowHeight
      ctx.beginPath()
      ctx.moveTo(headerWidth, y)
      ctx.lineTo(canvas.width, y)
      ctx.stroke()
    }
  }, [rowCount, colCount, cells, selection, config, canvasSize])

  // 事件处理
  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return

      const rect = canvasRef.current.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const coord = hitTest(x, y, config as Required<RenderConfig>)

      if (coord) {
        if (callbacks.onCellClick) {
          callbacks.onCellClick({ coord, event })
        }
      } else if (callbacks.onCanvasClick) {
        callbacks.onCanvasClick({ event })
      }
    },
    [config, callbacks]
  )

  const handleCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return

      const rect = canvasRef.current.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const coord = hitTest(x, y, config as Required<RenderConfig>)

      if (coord) {
        if (callbacks.onCellDoubleClick) {
          callbacks.onCellDoubleClick({ coord, event })
        }
      }
    },
    [config, callbacks]
  )

  const handleCanvasMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !callbacks.onCellMouseDown) return

      const rect = canvasRef.current.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const coord = hitTest(x, y, config as Required<RenderConfig>)

      if (coord) {
        callbacks.onCellMouseDown({ coord, event })
      }
    },
    [config, callbacks]
  )

  const handleCanvasMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !callbacks.onCellMouseMove) return

      const rect = canvasRef.current.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const coord = hitTest(x, y, config as Required<RenderConfig>)

      if (coord) {
        callbacks.onCellMouseMove({ coord, event })
      }
    },
    [config, callbacks]
  )

  const handleCanvasMouseUp = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !callbacks.onCellMouseUp) return

      const rect = canvasRef.current.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const coord = hitTest(x, y, config as Required<RenderConfig>)

      if (coord) {
        callbacks.onCellMouseUp({ coord, event })
      }
    },
    [config, callbacks]
  )

  return (
    <div style={{ position: 'relative', fontFamily: 'Roboto, Arial, sans-serif' }}>
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className={className}
        style={{ border: '1px solid #dadce0', cursor: 'default', ...style }}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
      />

      {/* 注意：编辑框由父组件实现，Canvas 不包含 textarea */}
    </div>
  )
})

CanvasSpreadsheet.displayName = 'CanvasSpreadsheet'

export { CanvasSpreadsheet }
