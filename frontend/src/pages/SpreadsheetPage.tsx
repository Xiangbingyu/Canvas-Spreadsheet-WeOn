import { useState, useMemo, useRef, useEffect } from 'react'
import { CanvasSpreadsheet } from '@/components/CanvasSpreadsheet'
import { InteractionEngine, CompositionHandler } from '@/spreadsheet'
import type { SelectionRange, RenderConfig, CellCoord } from '@/spreadsheet/model/types'
import type { InteractionCallbacks } from '@/spreadsheet/interaction/interaction'

// 默认配置
const DEFAULT_CONFIG: Required<RenderConfig> = {
  rowHeight: 26,
  colWidth: 100,
  headerHeight: 24,
  headerWidth: 44,
}

// 生成测试数据
const generateInitialCells = () => {
  const cells: Record<string, { value: string; styleId?: string }> = {}
  for (let r = 0; r < 20; r++) {
    for (let c = 0; c < 10; c++) {
      cells[`${r}:${c}`] = { value: '' }
    }
  }
  // 填充一些初始数据
  cells['0:0'] = { value: '姓名' }
  cells['0:1'] = { value: '年龄' }
  cells['0:2'] = { value: '城市' }
  return cells
}

export function SpreadsheetPage() {
  const [cells, setCells] = useState(generateInitialCells)
  const [selection, setSelection] = useState<SelectionRange>({
    start: { row: 0, col: 0 },
    end: { row: 0, col: 0 },
  })
  const [editingCell, setEditingCell] = useState<CellCoord | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isComposing, setIsComposing] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 创建交互引擎
  const engine = useMemo(
    () =>
      new InteractionEngine(DEFAULT_CONFIG, {
        onCellClick: ({ coord }) => {
          console.log('点击单元格:', coord.row, coord.col)
          setSelection({ start: coord, end: coord })
        },
        onCellDoubleClick: ({ coord }) => {
          console.log('双击单元格:', coord.row, coord.col)
          setEditingCell(coord)
          const cellKey = `${coord.row}:${coord.col}`
          setEditValue(cells[cellKey]?.value || '')
          setIsComposing(false)
        },
        onSelectionChange: ({ newSelection }) => {
          console.log('选区变化:', newSelection)
          setSelection(newSelection)
        },
        onCellEditSubmit: ({ coord, value }) => {
          console.log('提交编辑:', coord.row, coord.col, value)
          setCells((prev) => ({
            ...prev,
            [`${coord.row}:${coord.col}`]: { ...prev[`${coord.row}:${coord.col}`], value },
          }))
          setEditingCell(null)
        },
        onCellEditCancel: ({ coord }) => {
          console.log('取消编辑:', coord.row, coord.col)
          setEditingCell(null)
        },
      }),
    [cells]
  )

  // Composition handler
  const compositionHandler = useMemo(
    () => new CompositionHandler(engine as any),
    []
  )

  // textarea 自动聚焦
  useEffect(() => {
    if (editingCell && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [editingCell])

  // 全局键盘事件监听
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 如果输入框存在且聚焦，不处理键盘事件（由 textarea 处理）
      if (document.activeElement === textareaRef.current) {
        return
      }
      if (editingCell) {
        return
      }

      // Canvas 聚焦时处理键盘事件
      if (document.activeElement === canvasRef.current) {
        engine.handleKeyboard(e)
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [editingCell, engine])

  // 使 canvas 可聚焦
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.setAttribute('tabIndex', '0')
      canvasRef.current.addEventListener('focus', () => {
        console.log('Canvas focused')
      })
    }
  }, [])

  // textarea 位置计算
  const textareaStyle = useMemo(() => {
    if (!editingCell) return {}
    return {
      position: 'absolute',
      left: DEFAULT_CONFIG.headerWidth + editingCell.col * DEFAULT_CONFIG.colWidth + 4,
      top: DEFAULT_CONFIG.headerHeight + editingCell.row * DEFAULT_CONFIG.rowHeight + 3,
      width: DEFAULT_CONFIG.colWidth - 8,
      height: DEFAULT_CONFIG.rowHeight - 6,
      border: '2px solid #1a73e8',
      outline: 'none',
      padding: '0 4px',
      fontSize: '13px',
      lineHeight: `${DEFAULT_CONFIG.rowHeight - 6}px`,
      zIndex: 100,
      resize: 'none',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }
  }, [editingCell])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white font-[Roboto,Arial,sans-serif]">
      <div
        className="flex-1 overflow-auto bg-[#f8f9fa] p-4 flex items-center justify-center"
        style={{ fontFamily: 'Roboto, Arial, sans-serif' }}
      >
        <div style={{ position: 'relative' }}>
          <CanvasSpreadsheet
            ref={canvasRef}
            rowCount={20}
            colCount={10}
            cells={cells}
            selection={selection}
            editingCell={editingCell}
            config={DEFAULT_CONFIG}
            callbacks={{
              onCellClick: (args) => engine.handleCellClick(args),
              onCellDoubleClick: (args) => engine.handleCellDoubleClick(args),
              onCellMouseDown: (args) => engine.handleCellMouseDown(args),
              onCellMouseMove: (args) => engine.handleCellMouseMove(args),
              onCellMouseUp: (args) => engine.handleCellMouseUp(args),
              onCanvasClick: (args) => engine.handleCanvasClick(args),
              onCellEditSubmit: (args) => engine.submitEdit(args.value),
              onCellEditCancel: (args) => engine.cancelEdit(),
              onKeyboard: (args) => engine.handleKeyboard(args.event),
              onSelectionChange: (args) => setSelection(args.newSelection),
              onCellInputChange: (args) => {
                console.log('输入中:', args.coord.row, args.coord.col, args.value)
              },
              onCellCompositionStart: (args) => {
                compositionHandler.startComposition(args.coord, args.event)
                console.log('compositionstart callback')
              },
              onCellCompositionEnd: (args) => {
                compositionHandler.endComposition(args.event)
                console.log('compositionend callback')
              },
            }}
            style={{ display: 'block' }}
          />

          {/* 编辑框 overlay */}
          {editingCell && (
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value)
              }}
              onKeyDown={(e) => {
                // textarea 内的键盘事件
                if (e.key === 'Enter') {
                  e.preventDefault()
                  engine.submitEdit(textareaRef.current?.value || '')
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  engine.cancelEdit()
                } else if (e.key === 'Tab') {
                  // Tab 切换单元格
                  e.preventDefault()
                  engine.handleKeyboard(e as any)
                }
              }}
              onBlur={() => {
                if (!isComposing && textareaRef.current) {
                  engine.submitEdit(textareaRef.current.value)
                }
              }}
              onCompositionStart={(e) => {
                if (editingCell) {
                  setIsComposing(true)
                  compositionHandler.startComposition(editingCell, e.nativeEvent as CompositionEvent)
                  console.log('compositionstart')
                }
              }}
              onCompositionUpdate={(e) => {
                compositionHandler.onCompositionChange(e.data || '')
                console.log('compositionupdate', e.data)
              }}
              onCompositionEnd={(e) => {
                compositionHandler.endComposition(e.nativeEvent as CompositionEvent)
                setIsComposing(false)
                setEditValue(textareaRef.current?.value || '')
                console.log('compositionend', e.data)
              }}
              style={textareaStyle}
            />
          )}
        </div>
      </div>
    </div>
  )
}
