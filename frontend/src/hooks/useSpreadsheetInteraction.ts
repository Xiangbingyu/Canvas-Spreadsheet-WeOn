import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useDispatch, useSelector, useStore } from 'react-redux'
import { InteractionEngine } from '@/spreadsheet/interaction/interactionEngine'
import { GRID_CHROME } from '@/spreadsheet/utils/coordinates'
import { updateCell, setRangeValues } from '@/spreadsheet/store/workSheetStore'
import type { RangeValueCell } from '@/spreadsheet/store/workbookStore'
import { setSelectedCell } from '@/spreadsheet/store/selectStore'
import { setClipboard } from '@/spreadsheet/store'
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'
import { cellsToTSV, parseTSV } from '@/spreadsheet/utils/tsvConverter'
import { parseFormula, isFormula } from '@/spreadsheet/utils/formulaParser'
import { calculateFormula } from '@/spreadsheet/utils/formulaCalculator'
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
        const sheetId = reduxStore.getState().workSheet.sheetId
        dispatch(updateCell({ sheetId, row, col, value, style }))
      }
    },
    [dispatch, reduxStore]
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

      // 如果初始值未提供，从单元格读取
      const editValue = initialValue !== undefined ? initialValue : (cell?.value ?? '')

      // 如果单元格值是公式结果（以 #ERROR 开头），尝试恢复原始公式
      // 但由于我们没有存储原始公式，这里只能显示计算结果
      // 用户可以手动编辑为公式

      setEditValue(editValue)
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

      const ws = reduxStore.getState().workSheet

      // 检查是否是公式
      let displayValue = value
      if (isFormula(value)) {
        const parsed = parseFormula(value)
        const { result, error } = calculateFormula(ws, parsed)
        if (error) {
          // 公式计算错误，显示错误信息
          displayValue = `#ERROR: ${error}`
        } else {
          // 公式计算成功，显示结果
          displayValue = String(result)
        }
      }

      // 编辑只改文字、不改样式：把当前格已有样式一起带上提交，避免下游把
      // “缺省 style” 当成清空。读不到样式时为 undefined（保留语义），绝不传 null。
      const cell = ws.cells[`${target.row}:${target.col}`]
      const style: Style | undefined = cell?.styleId ? ws.styles[cell.styleId] : undefined

      // 走协同链路（或本地兜底）；选中态本地即时更新以保证 UI 响应
      commitCell(target.row, target.col, displayValue, style)
      canvasHandleRef.current?.invalidateCells([{ row: target.row, col: target.col }])
      dispatch(setSelectedCell({ row: target.row, col: target.col, value: displayValue, style }))
      setEditingCell(null)
      editingCellRef.current = null
      if (move) {
        engine.moveSelection(move.dr, move.dc, move.extend)
      }
      canvasHandleRef.current?.focus()
    },
    [commitCell, dispatch, engine, reduxStore]
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

        // Ctrl+C / Cmd+C：复制
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
          const ws = reduxStore.getState().workSheet
          const range = sel.range
          const cells: Record<string, { value: string; style?: Style }> = {}

          // 遍历选区范围内的所有单元格
          for (let row = range.start.row; row <= range.end.row; row++) {
            for (let col = range.start.col; col <= range.end.col; col++) {
              const key = `${row}:${col}`
              const cell = ws.cells[key]
              const style = cell?.styleId ? ws.styles[cell.styleId] : undefined
              cells[key] = {
                value: cell?.value ?? '',
                style,
              }
            }
          }

          // 存到内部剪贴板
          dispatch(
            setClipboard({
              cells,
              range: {
                startRow: range.start.row,
                startCol: range.start.col,
                endRow: range.end.row,
                endCol: range.end.col,
              },
            })
          )

          // 写入系统剪贴板（TSV 格式）
          const tsv = cellsToTSV(cells, {
            startRow: range.start.row,
            startCol: range.start.col,
            endRow: range.end.row,
            endCol: range.end.col,
          })
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(tsv).catch((err) => {
              console.warn('[useSpreadsheetInteraction] Failed to write to system clipboard:', err)
            })
          }

          event.preventDefault()
          return
        }

        // Ctrl+V / Cmd+V：粘贴
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
          const pasteFromClipboard = async () => {
            const clipboard = reduxStore.getState().clipboard
            const ws = reduxStore.getState().workSheet
            const sel = reduxStore.getState().selection

            // 优先使用内部剪贴板（保留样式）
            if (clipboard.range && Object.keys(clipboard.cells).length > 0) {
              const pasteStartRow = sel.row
              const pasteStartCol = sel.col
              const rowOffset = pasteStartRow - clipboard.range.startRow
              const colOffset = pasteStartCol - clipboard.range.startCol

              // 收集整片为「样式池化」结构，一条 setRangeValues 原子写入，
              // 替代逐格 commitCell（避免 N 格 = N 条 WS 消息抢锁，对齐协议提案）。
              const stylesPool: Record<string, Style> = {}
              const rangeCells: RangeValueCell[] = []
              const invalidCells: Array<{ row: number; col: number }> = []
              for (const [key, clipCell] of Object.entries(clipboard.cells)) {
                const [rowStr, colStr] = key.split(':')
                const origRow = parseInt(rowStr, 10)
                const origCol = parseInt(colStr, 10)
                const targetRow = origRow + rowOffset
                const targetCol = origCol + colOffset

                if (
                  targetRow < 1 ||
                  targetRow > ws.rowCount ||
                  targetCol < 1 ||
                  targetCol > ws.colCount
                ) {
                  continue
                }

                // 样式池化：相同样式只存一份，cell 用 styleId 引用；无样式则不带 styleId
                const styleId = clipCell.style
                  ? findOrCreateStyleId(stylesPool, clipCell.style)
                  : undefined
                rangeCells.push({
                  row: targetRow,
                  col: targetCol,
                  value: clipCell.value,
                  ...(styleId !== undefined ? { styleId } : {}),
                })
                invalidCells.push({ row: targetRow, col: targetCol })
              }

              if (rangeCells.length > 0) {
                // 本地兜底写入（协同 set_range_values 接口 ready 后改为走 WS 发送）
                const sheetId = reduxStore.getState().workSheet.sheetId
                dispatch(setRangeValues({ sheetId, styles: stylesPool, cells: rangeCells }))
                // 批量通知 Canvas 局部重绘，避免逐格触发整帧重绘
                canvasHandleRef.current?.invalidateCells(invalidCells)
              }
              return
            }

            // 内部剪贴板为空，尝试系统剪贴板（跨应用复制粘贴）
            try {
              if (!navigator.clipboard || !navigator.clipboard.readText) {
                throw new Error('System clipboard not available')
              }
              const text = await navigator.clipboard.readText()
              const parsed = parseTSV(text)
              if (!parsed) {
                throw new Error('Failed to parse clipboard content')
              }

              const pasteStartRow = sel.row
              const pasteStartCol = sel.col
              const rowOffset = pasteStartRow - parsed.range.startRow
              const colOffset = pasteStartCol - parsed.range.startCol

              // 系统剪贴板 TSV 只有内容、无样式：收集为 cells（仅 value），一条 setRangeValues 写入
              const rangeCells: RangeValueCell[] = []
              const invalidCells: Array<{ row: number; col: number }> = []
              for (const [key, clipCell] of Object.entries(parsed.cells)) {
                const [rowStr, colStr] = key.split(':')
                const origRow = parseInt(rowStr, 10)
                const origCol = parseInt(colStr, 10)
                const targetRow = origRow + rowOffset
                const targetCol = origCol + colOffset

                if (
                  targetRow < 1 ||
                  targetRow > ws.rowCount ||
                  targetCol < 1 ||
                  targetCol > ws.colCount
                ) {
                  continue
                }

                rangeCells.push({ row: targetRow, col: targetCol, value: clipCell.value })
                invalidCells.push({ row: targetRow, col: targetCol })
              }

              if (rangeCells.length > 0) {
                // 本地兜底写入（协同 set_range_values 接口 ready 后改为走 WS 发送）
                const sheetId = reduxStore.getState().workSheet.sheetId
                dispatch(setRangeValues({ sheetId, cells: rangeCells }))
                // 批量通知 Canvas 局部重绘
                canvasHandleRef.current?.invalidateCells(invalidCells)
              }
            } catch (err) {
              console.warn('[useSpreadsheetInteraction] System clipboard read failed:', err)
            }
          }

          pasteFromClipboard()
          event.preventDefault()
          return
        }

        if (event.key === 'Enter' || event.key === 'F2') {
          startEdit(sel.row, sel.col)
          event.preventDefault()
          return
        }
        // 不在这里处理单个字符输入，让输入法自己处理 composition
        // 中文输入法的第一个 keydown 不应该进入编辑态，应该等 composition 事件
        if (event.key === 'Delete' || event.key === 'Backspace') {
          // 只清空内容、保留样式：读出当前格已有样式一起提交，
          // 避免下游把「缺省 style」当成清空（与 submitEdit 同一处理）。
          const ws = reduxStore.getState().workSheet
          const cell = ws.cells[`${sel.row}:${sel.col}`]
          const style: Style | undefined = cell?.styleId ? ws.styles[cell.styleId] : undefined
          commitCell(sel.row, sel.col, '', style)
          canvasHandleRef.current?.invalidateCells([{ row: sel.row, col: sel.col }])
          dispatch(setSelectedCell({ row: sel.row, col: sel.col, value: '', style }))
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
