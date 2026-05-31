import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useDispatch, useSelector, useStore } from 'react-redux'
import { InteractionEngine } from '@/spreadsheet/interaction/interactionEngine'
import { GRID_CHROME } from '@/spreadsheet/utils/coordinates'
import { updateCell } from '@/spreadsheet/store/workSheetStore'
import { setSelectedCell } from '@/spreadsheet/store/selectStore'
import type { RootState } from '@/spreadsheet/store'
import type { Style } from '@/spreadsheet/model/types'
import type { GrideCanvasHandle } from '@/components/grideCanvas/GrideCanvas'

/**
 * 单元格提交回调（由上层注入）。
 * - 传入时：走协同链路（WS setCell → 后端广播 → 协同模块 dispatch → Canvas 重绘）。
 * - 不传时：本地兜底 dispatch(updateCell)，保证无协同环境（单测/离线）仍可用。
 */
export type CommitCellFn = (row: number, col: number, value: string, style?: Style) => void

export interface UseSpreadsheetInteractionOptions {
  onCommitCell?: CommitCellFn
}

const ENGINE_CONFIG = {
  rowHeight: 26,
  colWidth: 100,
  headerHeight: GRID_CHROME.headerRowHeight,
  headerWidth: GRID_CHROME.headerColWidth,
}

export function useSpreadsheetInteraction(options: UseSpreadsheetInteractionOptions = {}) {
  const { onCommitCell } = options
  const dispatch = useDispatch()
  const reduxStore = useStore<RootState>()
  const worksheet = useSelector((s: RootState) => s.workSheet)
  const selection = useSelector((s: RootState) => s.selection)

  // 把 onCommitCell 放进 ref，避免它变化时重建依赖它的 useCallback / useEffect
  const onCommitCellRef = useRef(onCommitCell)
  useEffect(() => {
    onCommitCellRef.current = onCommitCell
  }, [onCommitCell])

  /**
   * 统一的单元格写入：优先走协同回调，否则本地 dispatch 兜底。
   * 注意：走协同时不在此 dispatch(updateCell)，由协同模块收到广播后回写，避免双写。
   */
  const commitCell = useCallback(
    (row: number, col: number, value: string, style?: Style) => {
      const commit = onCommitCellRef.current
      if (commit) {
        commit(row, col, value, style)
      } else {
        dispatch(updateCell({ row, col, value, style }))
      }
    },
    [dispatch]
  )

  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [scroll, setScroll] = useState({ x: 0, y: 0 })

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const editingCellRef = useRef<{ row: number; col: number } | null>(null)
  const canvasHandleRef = useRef<GrideCanvasHandle>(null)

  const engine = useMemo(
    () =>
      new InteractionEngine(
        ENGINE_CONFIG,
        {
          rowCount: worksheet.rowCount,
          colCount: worksheet.colCount,
          defaultRowHeight: worksheet.defaultRowHeight,
          defaultColWidth: worksheet.defaultColWidth,
        },
        {}
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const startEdit = useCallback(
    (row: number, col: number, initialValue?: string) => {
      const ws = reduxStore.getState().workSheet
      const cell = ws.cells[`${row}:${col}`]
      setEditingCell({ row, col })
      editingCellRef.current = { row, col }
      setEditValue(initialValue !== undefined ? initialValue : (cell?.value ?? ''))
      // 立即 focus textarea，确保中文输入法能正确进入 composition
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          const len = textareaRef.current.value.length
          textareaRef.current.setSelectionRange(len, len)
        }
      }, 0)
    },
    [reduxStore]
  )

  const submitEdit = useCallback(
    (move?: { dr: number; dc: number; extend?: boolean }) => {
      const target = editingCellRef.current
      if (!target) return
      const value = textareaRef.current?.value ?? ''
      // 走协同链路（或本地兜底）；选中态本地即时更新以保证 UI 响应
      commitCell(target.row, target.col, value)
      dispatch(setSelectedCell({ row: target.row, col: target.col, value, style: undefined }))
      setEditingCell(null)
      editingCellRef.current = null
      if (move) {
        engine.moveSelection(move.dr, move.dc, move.extend)
      }
      canvasHandleRef.current?.focus()
    },
    [commitCell, dispatch, engine]
  )

  const cancelEdit = useCallback(() => {
    setEditingCell(null)
    editingCellRef.current = null
    canvasHandleRef.current?.focus()
  }, [])

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
        const sel = reduxStore.getState().selection
        if (event.key === 'Enter' || event.key === 'F2') {
          startEdit(sel.row, sel.col)
          event.preventDefault()
          return
        }
        // 不在这里处理单个字符输入，让输入法自己处理 composition
        // 中文输入法的第一个 keydown 不应该进入编辑态，应该等 composition 事件
        if (event.key === 'Delete' || event.key === 'Backspace') {
          commitCell(sel.row, sel.col, '')
          dispatch(setSelectedCell({ row: sel.row, col: sel.col, value: '' }))
          event.preventDefault()
        }
      },
      onCellCompositionStart: () => {
        // 中文输入法开始时进入编辑态
        const sel = reduxStore.getState().selection
        console.log(
          '[useSpreadsheetInteraction] composition start, entering edit mode for',
          sel.row,
          sel.col
        )
        startEdit(sel.row, sel.col)
      },
    })
    // 注入 ViewportController
    if (canvasHandleRef.current) {
      engine.setViewportController({
        scrollBy: (deltaX: number, deltaY: number) => {
          canvasHandleRef.current?.scrollBy(deltaX, deltaY)
        },
        getViewport: () => {
          const viewport = canvasHandleRef.current?.getViewport()
          return viewport || { scrollX: 0, scrollY: 0, viewportWidth: 0, viewportHeight: 0 }
        },
      })
    }
  }, [engine, worksheet, dispatch, startEdit, reduxStore, commitCell])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingCellRef.current) return
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

  useEffect(() => {
    if (editingCell && textareaRef.current) {
      const el = textareaRef.current
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
  }, [editingCell])

  const textareaStyle = useMemo<CSSProperties | undefined>(() => {
    if (!editingCell) return undefined
    const rowHeight = worksheet.defaultRowHeight
    const colWidth = worksheet.defaultColWidth
    const x = GRID_CHROME.headerColWidth + (editingCell.col - 1) * colWidth - scroll.x
    const y = GRID_CHROME.headerRowHeight + (editingCell.row - 1) * rowHeight - scroll.y

    // 从当前单元格读取样式
    const cell = worksheet.cells[`${editingCell.row}:${editingCell.col}`]
    const cellStyle = cell?.styleId ? worksheet.styles[cell.styleId] : undefined

    return {
      position: 'absolute',
      left: x + 1,
      top: y + 1,
      width: colWidth - 2,
      height: rowHeight - 2,
      border: '2px solid #1a73e8',
      outline: 'none',
      padding: '0 4px',
      fontSize: cellStyle?.fontSize ? `${cellStyle.fontSize}px` : '13px',
      fontFamily: cellStyle?.fontFamily ?? 'Roboto, Arial, sans-serif',
      fontWeight: cellStyle?.bold ? 'bold' : 'normal',
      fontStyle: cellStyle?.italic ? 'italic' : 'normal',
      textDecoration: cellStyle?.underline ? 'underline' : 'none',
      color: cellStyle?.color ?? '#202124',
      backgroundColor: cellStyle?.bgColor ?? '#fff',
      textAlign: cellStyle?.hAlign ?? 'left',
      lineHeight: `${rowHeight - 6}px`,
      zIndex: 100,
      resize: 'none',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }
  }, [
    editingCell,
    worksheet.defaultRowHeight,
    worksheet.defaultColWidth,
    scroll,
    worksheet.cells,
    worksheet.styles,
  ])

  const onScrollChange = useCallback((x: number, y: number) => {
    setScroll((prev) => (prev.x === x && prev.y === y ? prev : { x, y }))
  }, [])

  const formulaBarValue = editingCell ? editValue : (selection.value ?? '')
  const formulaBarAddress = selection.address || 'A1'

  return {
    engine,
    canvasHandleRef,
    editingCell,
    editValue,
    setEditValue,
    textareaRef,
    isComposingRef,
    textareaStyle,
    submitEdit,
    cancelEdit,
    onScrollChange,
    formulaBarValue,
    formulaBarAddress,
  }
}
