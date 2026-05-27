import type { WorksheetData } from '@/spreadsheet/model/types'
import { GRID_CHROME } from '@/spreadsheet/render/chrome'
import type { Viewport } from '@/spreadsheet/render/viewport'
import { setSelectedCell, type AppDispatch, type RootState } from '@/spreadsheet/store'

/** 画布坐标 → 数据区单元格行列（点在表头或表外返回 null） */
function hitTestCell(
  canvasX: number,
  canvasY: number,
  viewport: Viewport,
  worksheet: WorksheetData
) {
  const { headerColWidth, headerRowHeight } = GRID_CHROME
  const rowHeight = worksheet.defaultRowHeight
  const colWidth = worksheet.defaultColWidth

  if (canvasX < headerColWidth || canvasY < headerRowHeight) {
    return null
  }

  const sheetX = viewport.scrollX + (canvasX - headerColWidth)
  const sheetY = viewport.scrollY + (canvasY - headerRowHeight)

  if (sheetX < 0 || sheetY < 0) {
    return null
  }

  const col = Math.floor(sheetX / colWidth) + 1
  const row = Math.floor(sheetY / rowHeight) + 1

  if (row < 1 || col < 1 || row > worksheet.rowCount || col > worksheet.colCount) {
    return null
  }

  return { row, col }
}

/** 读取单元格当前值与样式，写入 selection，并输出控制台信息 */
function selectCellAt(row: number, col: number, dispatch: AppDispatch, getState: () => RootState) {
  const workSheet = getState().workSheet
  const key = `${row}:${col}`
  const cell = workSheet.cells[key]
  const style = cell?.styleId ? workSheet.styles[cell.styleId] : undefined
  const value = cell?.value ?? ''

  const current = getState().selection
  if (current.row === row && current.col === col) {
    return
  }

  dispatch(
    setSelectedCell({
      row,
      col,
      value,
      style,
    })
  )

  console.log('selection', getState().selection)
}

/**
 * 为 Canvas 绑定点击选中交互
 * @returns 解绑函数，在组件卸载时调用
 */
export function attachCellSelectInteraction(
  canvas: HTMLCanvasElement,
  options: {
    getViewport: () => Viewport
    getWorksheet: () => WorksheetData
    dispatch: AppDispatch
    getState: () => RootState
  }
) {
  const onPointerDown = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    const canvasX = event.clientX - rect.left
    const canvasY = event.clientY - rect.top

    const hit = hitTestCell(canvasX, canvasY, options.getViewport(), options.getWorksheet())
    if (!hit) {
      return
    }

    selectCellAt(hit.row, hit.col, options.dispatch, options.getState)
  }

  canvas.addEventListener('pointerdown', onPointerDown)

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
  }
}
