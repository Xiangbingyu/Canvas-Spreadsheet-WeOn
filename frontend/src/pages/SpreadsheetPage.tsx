// 主页面：组合 Menubar / Toolbar / FormulaBar / GrideCanvas + 编辑交互
// InteractionEngine 在此创建为唯一实例，通过 props 传给 GrideCanvas
// 编辑态用 textarea overlay + Composition 处理中文输入

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useDispatch, useSelector, useStore } from 'react-redux'
import GrideCanvas, { type GrideCanvasHandle } from '@/components/grideCanvas/GrideCanvas'
import { InteractionEngine, type RootState } from '@/spreadsheet'
import { updateCell } from '@/spreadsheet/store/workSheetStore'
import { setSelectedCell } from '@/spreadsheet/store/selectStore'
import { GRID_CHROME } from '@/spreadsheet/render/chrome'
import { Menubar, Toolbar, FormulaBar, StatusBar, SheetTabs, Loading } from '@/components'

const DEFAULT_CONFIG = {
  rowHeight: 26,
  colWidth: 100,
  headerHeight: GRID_CHROME.headerRowHeight,
  headerWidth: GRID_CHROME.headerColWidth,
}

export function SpreadsheetPage() {
  const dispatch = useDispatch()
  const reduxStore = useStore<RootState>()
  const worksheet = useSelector((s: RootState) => s.workSheet)
  const selection = useSelector((s: RootState) => s.selection)

  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [scroll, setScroll] = useState({ x: 0, y: 0 })

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const editingCellRef = useRef<{ row: number; col: number } | null>(null)
  const canvasHandleRef = useRef<GrideCanvasHandle>(null)

  // 单一 engine 实例（不放 useMemo，避免依赖变化重建）
  const engine = useMemo(
    () =>
      new InteractionEngine(
        DEFAULT_CONFIG,
        {
          rowCount: worksheet.rowCount,
          colCount: worksheet.colCount,
          defaultRowHeight: worksheet.defaultRowHeight,
          defaultColWidth: worksheet.defaultColWidth,
        },
        {}
      ),
    // 仅创建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // 进入编辑态 helper：用当前 worksheet 的值初始化 textarea
  const startEdit = useCallback(
    (row: number, col: number, initialValue?: string) => {
      const ws = reduxStore.getState().workSheet
      const cell = ws.cells[`${row}:${col}`]
      setEditingCell({ row, col })
      editingCellRef.current = { row, col }
      setEditValue(initialValue !== undefined ? initialValue : (cell?.value ?? ''))
    },
    [reduxStore]
  )

  // 提交编辑：写入 store 并同步选中信息。move 决定提交后选区如何移动（默认不动）。
  const submitEdit = useCallback(
    (move?: { dr: number; dc: number; extend?: boolean }) => {
      const target = editingCellRef.current
      if (!target) return
      const value = textareaRef.current?.value ?? ''
      dispatch(updateCell({ row: target.row, col: target.col, value }))
      dispatch(setSelectedCell({ row: target.row, col: target.col, value, style: undefined }))
      setEditingCell(null)
      editingCellRef.current = null
      if (move) {
        // 等 React 把 textarea 卸载、selection store 更新到 target 后再移动
        // engine.moveSelection 是基于当前 selection.end 移动，所以先把 end 同步到 target
        engine.moveSelection(move.dr, move.dc, move.extend)
      }
      // 把焦点还给 canvas，保证后续键盘事件能命中
      canvasHandleRef.current?.focus()
    },
    [dispatch, engine]
  )

  // 取消编辑
  const cancelEdit = useCallback(() => {
    setEditingCell(null)
    editingCellRef.current = null
    canvasHandleRef.current?.focus()
  }, [])

  // 每次 worksheet / selection 变化时刷新 engine 的 callbacks 与 config
  useEffect(() => {
    engine.setWorksheetConfig({
      rowCount: worksheet.rowCount,
      colCount: worksheet.colCount,
      defaultRowHeight: worksheet.defaultRowHeight,
      defaultColWidth: worksheet.defaultColWidth,
    })
    engine.setCallbacks({
      onCellClick: ({ coord }) => {
        const cell = worksheet.cells[`${coord.row}:${coord.col}`]
        dispatch(
          setSelectedCell({
            row: coord.row,
            col: coord.col,
            value: cell?.value ?? '',
            style: cell?.styleId ? worksheet.styles[cell.styleId] : undefined,
            range: { start: coord, end: coord },
          })
        )
      },
      onCellDoubleClick: ({ coord }) => {
        startEdit(coord.row, coord.col)
      },
      onSelectionChange: ({ newSelection }) => {
        // active cell 用 start 作为锚点（FormulaBar 显示这里的值）
        const active = newSelection.start
        const cell = worksheet.cells[`${active.row}:${active.col}`]
        dispatch(
          setSelectedCell({
            row: active.row,
            col: active.col,
            value: cell?.value ?? '',
            style: cell?.styleId ? worksheet.styles[cell.styleId] : undefined,
            range: newSelection,
          })
        )
      },
      onKeyboard: ({ event }) => {
        // engine 未消耗的键：
        const sel = reduxStore.getState().selection
        // Enter / F2：进入编辑态（保留原值）
        if (event.key === 'Enter' || event.key === 'F2') {
          startEdit(sel.row, sel.col)
          event.preventDefault()
          return
        }
        // 字母数字等可打印字符：进入编辑态并以该字符开始
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          startEdit(sel.row, sel.col, event.key)
          event.preventDefault()
          return
        }
        // Delete / Backspace 清空当前单元格
        if (event.key === 'Delete' || event.key === 'Backspace') {
          dispatch(updateCell({ row: sel.row, col: sel.col, value: '' }))
          dispatch(setSelectedCell({ row: sel.row, col: sel.col, value: '' }))
          event.preventDefault()
        }
      },
    })
  }, [engine, worksheet, dispatch, startEdit, reduxStore])

  // 选区随键盘移动后，工具栏的 FormulaBar 也要拿到对应单元格内容
  // engine.handleKeyboard 内部的 onSelectionChange 已经做了，这里只需绑定 document keydown
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 编辑态下不让 document 抢键盘，由 textarea 自己处理
      if (editingCellRef.current) return
      // 真正在编辑的输入控件才放行：
      // - TEXTAREA / contentEditable
      // - 非 readonly 的 INPUT（FormulaBar 的 input 是 readonly，不算）
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'TEXTAREA' || target.isContentEditable) return
        if (tag === 'INPUT') {
          const input = target as HTMLInputElement
          if (!input.readOnly && !input.disabled) return
        }
      }
      engine.handleKeyboard(event)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [engine])

  // textarea 进入编辑态后自动聚焦
  useEffect(() => {
    if (editingCell && textareaRef.current) {
      const el = textareaRef.current
      el.focus()
      // 把光标定位到末尾，方便键入接续
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
  }, [editingCell])

  // textarea 位置：与 gridRenderer 的 getCellRect 公式一致
  const textareaStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!editingCell) return undefined
    const rowHeight = worksheet.defaultRowHeight
    const colWidth = worksheet.defaultColWidth
    const x = GRID_CHROME.headerColWidth + (editingCell.col - 1) * colWidth - scroll.x
    const y = GRID_CHROME.headerRowHeight + (editingCell.row - 1) * rowHeight - scroll.y
    return {
      position: 'absolute',
      left: x + 1,
      top: y + 1,
      width: colWidth - 2,
      height: rowHeight - 2,
      border: '2px solid #1a73e8',
      outline: 'none',
      padding: '0 4px',
      fontSize: '13px',
      lineHeight: `${rowHeight - 6}px`,
      zIndex: 100,
      resize: 'none',
      overflow: 'hidden',
      boxSizing: 'border-box',
      background: '#fff',
    }
  }, [editingCell, worksheet.defaultRowHeight, worksheet.defaultColWidth, scroll])

  // FormulaBar 显示
  const formulaBarValue = editingCell ? editValue : (selection.value ?? '')
  const formulaBarAddress = selection.address || 'A1'

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white font-[Roboto,Arial,sans-serif]">
      <Menubar />
      <Toolbar />
      <FormulaBar cellAddress={formulaBarAddress} value={formulaBarValue} />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <GrideCanvas
          ref={canvasHandleRef}
          interactionEngine={engine}
          onScrollChange={(x, y) =>
            setScroll((prev) => (prev.x === x && prev.y === y ? prev : { x, y }))
          }
        />

        {editingCell && (
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (isComposingRef.current) return
              if (e.key === 'Enter') {
                e.preventDefault()
                // Shift+Enter 上移；Enter 下移
                submitEdit({ dr: e.shiftKey ? -1 : 1, dc: 0 })
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelEdit()
              } else if (e.key === 'Tab') {
                e.preventDefault()
                submitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 })
              } else if (
                e.key === 'ArrowUp' ||
                e.key === 'ArrowDown' ||
                e.key === 'ArrowLeft' ||
                e.key === 'ArrowRight'
              ) {
                // 方向键：提交并按方向移动选区（与 Excel/Sheets 一致）
                e.preventDefault()
                const map: Record<string, { dr: number; dc: number }> = {
                  ArrowUp: { dr: -1, dc: 0 },
                  ArrowDown: { dr: 1, dc: 0 },
                  ArrowLeft: { dr: 0, dc: -1 },
                  ArrowRight: { dr: 0, dc: 1 },
                }
                submitEdit(map[e.key])
              }
            }}
            onBlur={() => {
              if (!isComposingRef.current && editingCellRef.current) {
                submitEdit()
              }
            }}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false
              setEditValue((e.target as HTMLTextAreaElement).value)
            }}
            style={textareaStyle}
          />
        )}

        <Loading visible={false} />
      </div>

      <StatusBar onlineCount={3} userName="演示用户" />
      <SheetTabs />
    </div>
  )
}
