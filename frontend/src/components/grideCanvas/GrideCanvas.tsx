// 分层 Canvas 表格组件，连接 Redux 数据、渲染器和交互引擎。
// 输入工作表与选区状态，输出 grid/content/overlay 三层画布。

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { useSelector, useStore } from 'react-redux'
import {
  ALL_CANVAS_LAYERS,
  useCanvasInteraction,
  useCanvasRenderLoop,
  useLayeredCanvas,
  type CanvasLayer,
  type LayeredCanvasLayout,
} from '@/hooks'
import {
  createViewport,
  getDataViewportSize,
  getSheetSize,
  clampScroll,
  renderContentLayer,
  renderGridLayer,
  renderOverlayLayer,
  type RenderGridOptions,
} from '@/spreadsheet/render'
import { resolveRemoteCursorColor } from '@/spreadsheet/render/layerRenderer'
import { canvasPerf, sheetUpdatePerf } from '@/spreadsheet/render/perfMonitor'
import type { Viewport } from '@/spreadsheet/render'
import type { RootState } from '@/spreadsheet/store'
import { setClipboard } from '@/spreadsheet/store'
import { updateCell } from '@/spreadsheet/store/workSheetStore'
import { cellsToTSV, parseTSV } from '@/spreadsheet/utils/tsvConverter'
import type { InteractionEngine } from '@/spreadsheet/interaction/interactionEngine'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import { GRID_CHROME } from '@/spreadsheet/utils/coordinates'

const MIN_THUMB_SIZE = 24

type ScrollUi = {
  scrollX: number
  scrollY: number
  dataViewportWidth: number
  dataViewportHeight: number
  sheetWidth: number
  sheetHeight: number
}

type RemoteCursorWithOptionalSheet = {
  row: number
  col: number
  sheetId?: string
}

export type GrideCanvasProps = {
  interactionEngine: InteractionEngine
  /** 滚动变化时上报，父组件用于定位 textarea */
  onScrollChange?: (scrollX: number, scrollY: number) => void
  /** 行列操作的 undo/redo 包装函数 */
  executeRowColWithHistory?: (
    action: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col',
    index: number
  ) => void
}

export type GrideCanvasHandle = {
  /** 让 canvas 重新拿到焦点（提交编辑后调用，确保后续键盘事件能被命中） */
  focus: () => void
  /** 传入横向/纵向增量，返回结果为触发 Canvas 视口滚动并重绘。 */
  scrollBy: (deltaX: number, deltaY: number) => void
  /** 传入目标 scrollX/scrollY，返回结果为滚动到限制后的合法位置。 */
  scrollTo: (scrollX: number, scrollY: number) => void
  /** 无传入参数，返回当前 Canvas viewport 快照，供交互模块自动滚动后重新命中。 */
  getViewport: () => Viewport
}

type GridScrollBarProps = {
  orientation: 'horizontal' | 'vertical'
  scroll: number
  maxScroll: number
  viewportSize: number
  contentSize: number
  onScroll: (value: number) => void
}

type CanvasLayerContexts = {
  grid: CanvasRenderingContext2D
  content: CanvasRenderingContext2D
  overlay: CanvasRenderingContext2D
}

/**
 * 作用：计算滚动条滑块尺寸与偏移。
 * 传入参数：viewportSize 为视口尺寸，contentSize 为内容尺寸，scroll/maxScroll 为当前滚动状态。
 * 返回结果：返回轨道尺寸、滑块尺寸和滑块偏移，供滚动条组件渲染。
 */
function computeThumbMetrics(
  viewportSize: number,
  contentSize: number,
  scroll: number,
  maxScroll: number
) {
  const trackSize = viewportSize
  let thumbSize = MIN_THUMB_SIZE

  if (contentSize > 0 && trackSize > 0) {
    thumbSize = Math.max(MIN_THUMB_SIZE, (viewportSize / contentSize) * trackSize)
  }
  if (thumbSize > trackSize) {
    thumbSize = trackSize
  }

  let thumbOffset = 0
  if (maxScroll > 0 && trackSize > thumbSize) {
    thumbOffset = (scroll / maxScroll) * (trackSize - thumbSize)
  }

  return { trackSize, thumbSize, thumbOffset }
}

/**
 * 作用：获取单个 Canvas 的 2D 上下文，并按当前 DPR 设置绘制坐标变换。
 * 传入参数：canvas 为目标画布。
 * 返回结果：成功返回 CanvasRenderingContext2D，失败返回 null。
 */
function prepareCanvasContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) {
    return null
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

/**
 * 作用：从三层 Canvas ref 中获取绘制上下文，供 GrideCanvas 胶水层调用 renderer。
 * 传入参数：grid/content/overlay 三个 HTMLCanvasElement。
 * 返回结果：三层 ctx 全部可用时返回对象，否则返回 null。
 */
function prepareLayerContexts(
  gridCanvas: HTMLCanvasElement | null,
  contentCanvas: HTMLCanvasElement | null,
  overlayCanvas: HTMLCanvasElement | null
): CanvasLayerContexts | null {
  const grid = prepareCanvasContext(gridCanvas)
  const content = prepareCanvasContext(contentCanvas)
  const overlay = prepareCanvasContext(overlayCanvas)

  if (!grid || !content || !overlay) {
    return null
  }

  return { grid, content, overlay }
}

/**
 * 作用：渲染自定义滚动条，并把拖拽/点击转换为滚动值。
 * 传入参数：orientation 为方向，scroll/maxScroll 为滚动状态，onScroll 接收新的滚动值。
 * 返回结果：返回 React 滚动条元素；不读取 Redux，不修改业务数据。
 */
function GridScrollBar({
  orientation,
  scroll,
  maxScroll,
  viewportSize,
  contentSize,
  onScroll,
}: GridScrollBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startPointer: number; startScroll: number } | null>(null)

  const isVertical = orientation === 'vertical'
  const { thumbSize, thumbOffset } = computeThumbMetrics(
    viewportSize,
    contentSize,
    scroll,
    maxScroll
  )

  const scrollFromPointer = useCallback(
    /**
     * 作用：将滚动条轨道上的指针位置转换为实际 scroll 值。
     * 传入参数：pointer 为指针在轨道内的坐标。
     * 返回结果：无返回值，通过 onScroll 通知调用方。
     */
    (pointer: number) => {
      if (maxScroll <= 0) {
        return
      }

      const { thumbSize: currentThumbSize, trackSize: currentTrackSize } = computeThumbMetrics(
        viewportSize,
        contentSize,
        scroll,
        maxScroll
      )
      const movable = Math.max(1, currentTrackSize - currentThumbSize)
      const ratio = Math.min(1, Math.max(0, (pointer - currentThumbSize / 2) / movable))
      onScroll(ratio * maxScroll)
    },
    [contentSize, maxScroll, onScroll, scroll, viewportSize]
  )

  /**
   * 作用：处理轨道点击，跳转到点击位置对应的滚动偏移。
   * 传入参数：event 为 React pointer 事件。
   * 返回结果：无返回值，通过 scrollFromPointer 间接触发 onScroll。
   */
  const onTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (maxScroll <= 0) {
      return
    }

    const track = trackRef.current
    if (!track) {
      return
    }

    const rect = track.getBoundingClientRect()
    const pointer = isVertical ? event.clientY - rect.top : event.clientX - rect.left
    scrollFromPointer(pointer)
  }

  /**
   * 作用：开始拖拽滚动条滑块，并记录初始指针和滚动位置。
   * 传入参数：event 为 React pointer 事件。
   * 返回结果：无返回值，内部写入 dragRef。
   */
  const onThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (maxScroll <= 0) {
      return
    }

    event.stopPropagation()
    dragRef.current = {
      startPointer: isVertical ? event.clientY : event.clientX,
      startScroll: scroll,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /**
   * 作用：拖拽滑块时根据指针位移计算下一次滚动值。
   * 传入参数：event 为 React pointer 事件。
   * 返回结果：无返回值，通过 onScroll 通知调用方。
   */
  const onThumbPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || maxScroll <= 0) {
      return
    }

    const { thumbSize: currentThumbSize, trackSize: currentTrackSize } = computeThumbMetrics(
      viewportSize,
      contentSize,
      scroll,
      maxScroll
    )
    const movable = Math.max(1, currentTrackSize - currentThumbSize)
    const pointer = isVertical ? event.clientY : event.clientX
    const delta = pointer - drag.startPointer
    const nextScroll = drag.startScroll + (delta / movable) * maxScroll
    onScroll(nextScroll)
  }

  /**
   * 作用：结束滚动条拖拽并释放 pointer capture。
   * 传入参数：event 为 React pointer 事件。
   * 返回结果：无返回值，内部清空 dragRef。
   */
  const onThumbPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const trackClass = isVertical
    ? 'relative w-[14px] shrink-0 cursor-default border-l border-[#dadce0] bg-[#f1f3f4]'
    : 'relative h-[14px] min-w-0 flex-1 cursor-default border-t border-[#dadce0] bg-[#f1f3f4]'

  const thumbClass = isVertical
    ? 'absolute left-[3px] w-[8px] rounded-full bg-[#bdc1c6] hover:bg-[#9aa0a6]'
    : 'absolute top-[3px] h-[8px] rounded-full bg-[#bdc1c6] hover:bg-[#9aa0a6]'

  const thumbStyle = isVertical
    ? { top: thumbOffset, height: thumbSize }
    : { left: thumbOffset, width: thumbSize }

  return (
    <div
      ref={trackRef}
      className={trackClass}
      onPointerDown={onTrackPointerDown}
      role="scrollbar"
      aria-orientation={orientation}
      aria-valuenow={scroll}
      aria-valuemin={0}
      aria-valuemax={maxScroll}
    >
      {maxScroll > 0 && (
        <div
          className={thumbClass}
          style={thumbStyle}
          onPointerDown={onThumbPointerDown}
          onPointerMove={onThumbPointerMove}
          onPointerUp={onThumbPointerUp}
          onPointerCancel={onThumbPointerUp}
        />
      )}
    </div>
  )
}

/**
 * 作用：表格 Canvas 入口组件，从 Redux 获取 worksheet/selection 并组合分层 Canvas hooks。
 * 传入参数：无显式 props；组件通过 Redux 读取外部 Excel 解析后的 WorksheetData。
 * 返回结果：返回三层 Canvas 和滚动条 UI；不直接修改 Redux 数据。
 */
function GrideCanvas(
  { interactionEngine, onScrollChange, executeRowColWithHistory }: GrideCanvasProps,
  ref: Ref<GrideCanvasHandle>
) {
  const reduxStore = useStore<RootState>()
  const worksheet = useSelector((state: RootState) => state.workSheet)
  const selection = useSelector((state: RootState) => state.selection)
  const userCursors = useSelector((state: RootState) => state.collab.userCursors)
  const users = useSelector((state: RootState) => state.collab.users)
  const myClientId = useSelector((state: RootState) => state.collab.clientId)
  const viewportRef = useRef<Viewport>(createViewport())

  const layout: LayeredCanvasLayout = useMemo(
    () => ({
      rowCount: worksheet.rowCount,
      colCount: worksheet.colCount,
      rowHeight: worksheet.defaultRowHeight,
      colWidth: worksheet.defaultColWidth,
    }),
    [worksheet.colCount, worksheet.defaultColWidth, worksheet.defaultRowHeight, worksheet.rowCount]
  )

  const [scrollUi, setScrollUi] = useState<ScrollUi>({
    scrollX: 0,
    scrollY: 0,
    dataViewportWidth: 0,
    dataViewportHeight: 0,
    sheetWidth: 0,
    sheetHeight: 0,
  })

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    type: 'row' | 'col' | 'cell' | null
    index: number | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    type: null,
    index: null,
  })

  const { containerRef, gridCanvasRef, contentCanvasRef, overlayCanvasRef, layoutVersion } =
    useLayeredCanvas({
      layout,
      viewportRef,
    })

  const getRenderOptions = useCallback(() => {
    const state = reduxStore.getState()
    return {
      worksheet: state.workSheet,
      viewport: viewportRef.current,
      selection:
        state.selection.range ??
        ({
          start: { row: state.selection.row, col: state.selection.col },
          end: { row: state.selection.row, col: state.selection.col },
        } satisfies RenderGridOptions['selection']),
      activeCell: { row: state.selection.row, col: state.selection.col },
      remoteCursors: Object.entries(state.collab.userCursors)
        .filter(([clientId, cursor]) => {
          const cursorSheetId = (cursor as RemoteCursorWithOptionalSheet).sheetId
          return clientId !== state.collab.clientId && cursorSheetId === state.workSheet.sheetId
        })
        .map(([clientId, cursor]) => ({
          clientId,
          row: cursor.row,
          col: cursor.col,
          name:
            state.collab.users.find((user) => user.clientId === clientId)?.name ||
            clientId.slice(-6),
          color: resolveRemoteCursorColor(clientId, state.collab.users),
        })),
    }
  }, [reduxStore])

  const renderDirtyLayers = useCallback(
    /**
     * 作用：根据 rAF 调度输出的 dirty layer 集合调用对应 renderer。
     * 传入参数：dirtyLayers 为本帧需要重绘的层集合。
     * 返回结果：无返回值；只调用 Canvas renderer，不修改 Redux 数据。
     */
    (dirtyLayers: Set<CanvasLayer>) => {
      const contexts = prepareLayerContexts(
        gridCanvasRef.current,
        contentCanvasRef.current,
        overlayCanvasRef.current
      )
      if (!contexts || dirtyLayers.size === 0) {
        return
      }

      const options: RenderGridOptions = getRenderOptions()
      const renderStart = performance.now()
      const dirtyLayerList = Array.from(dirtyLayers)
      sheetUpdatePerf.markRenderStart(dirtyLayerList)

      if (dirtyLayers.has('grid')) {
        renderGridLayer(contexts.grid, options)
      }
      if (dirtyLayers.has('content')) {
        renderContentLayer(contexts.content, options)
      }
      if (dirtyLayers.has('overlay')) {
        renderOverlayLayer(contexts.overlay, options)
      }

      const renderDuration = performance.now() - renderStart
      canvasPerf.recordRender(renderDuration)
      sheetUpdatePerf.markRenderEnd(renderDuration, dirtyLayerList)
    },
    [contentCanvasRef, getRenderOptions, gridCanvasRef, overlayCanvasRef]
  )

  const { scheduleRender } = useCanvasRenderLoop({
    onRender: renderDirtyLayers,
  })

  const publishScrollUi = useCallback(() => {
    const viewport = viewportRef.current
    const sheet = getSheetSize(layout.rowCount, layout.colCount, layout.rowHeight, layout.colWidth)
    const dataViewport = getDataViewportSize(viewport)

    setScrollUi({
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      dataViewportWidth: dataViewport.width,
      dataViewportHeight: dataViewport.height,
      sheetWidth: sheet.width,
      sheetHeight: sheet.height,
    })
  }, [layout.colCount, layout.colWidth, layout.rowCount, layout.rowHeight])

  const applyScroll = useCallback(
    /**
     * 作用：应用横向/纵向滚动，限制边界后通过 rAF 触发分层重绘。
     * 传入参数：nextX/nextY 为待应用的滚动偏移。
     * 返回结果：无返回值，更新 viewportRef 和滚动条 UI。
     */
    (nextX: number, nextY: number) => {
      const viewport = viewportRef.current
      const sheet = getSheetSize(
        layout.rowCount,
        layout.colCount,
        layout.rowHeight,
        layout.colWidth
      )
      const dataViewport = getDataViewportSize(viewport)
      const clamped = clampScroll(
        nextX,
        nextY,
        dataViewport.width,
        dataViewport.height,
        sheet.width,
        sheet.height
      )

      if (viewport.scrollX === clamped.scrollX && viewport.scrollY === clamped.scrollY) {
        return
      }

      viewport.scrollX = clamped.scrollX
      viewport.scrollY = clamped.scrollY
      interactionEngine.setScroll(clamped.scrollX, clamped.scrollY)
      onScrollChange?.(clamped.scrollX, clamped.scrollY)
      publishScrollUi()
      scheduleRender(ALL_CANVAS_LAYERS)
    },
    [
      layout.colCount,
      layout.colWidth,
      layout.rowCount,
      layout.rowHeight,
      interactionEngine,
      onScrollChange,
      publishScrollUi,
      scheduleRender,
    ]
  )

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        overlayCanvasRef.current?.focus()
      },
      scrollBy(deltaX: number, deltaY: number) {
        const viewport = viewportRef.current
        applyScroll(viewport.scrollX + deltaX, viewport.scrollY + deltaY)
      },
      scrollTo(scrollX: number, scrollY: number) {
        applyScroll(scrollX, scrollY)
      },
      getViewport() {
        return { ...viewportRef.current }
      },
    }),
    [applyScroll, overlayCanvasRef]
  )

  const onWheelScroll = useCallback(
    /**
     * 作用：将滚轮增量转换为 Canvas 视口滚动。
     * 传入参数：deltaX/deltaY 为浏览器滚轮事件提供的滚动增量。
     * 返回结果：无返回值，通过 applyScroll 更新视口。
     */
    (deltaX: number, deltaY: number) => {
      const viewport = viewportRef.current
      applyScroll(viewport.scrollX + deltaX, viewport.scrollY + deltaY)
    },
    [applyScroll]
  )

  const handleCanvasContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      const canvas = event.currentTarget
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      let type: 'row' | 'col' | 'cell' | null = null
      let index: number | null = null

      // 判断是否点在行号区（左侧表头）
      if (x < GRID_CHROME.headerColWidth && y >= GRID_CHROME.headerRowHeight) {
        type = 'row'
        const rowHeight = worksheet.defaultRowHeight
        const sheetY = viewportRef.current.scrollY + (y - GRID_CHROME.headerRowHeight)
        index = Math.floor(sheetY / rowHeight) + 1
        if (index < 1 || index > worksheet.rowCount) {
          index = null
        }
      }
      // 判断是否点在列号区（顶部表头）
      else if (y < GRID_CHROME.headerRowHeight && x >= GRID_CHROME.headerColWidth) {
        type = 'col'
        const colWidth = worksheet.defaultColWidth
        const sheetX = viewportRef.current.scrollX + (x - GRID_CHROME.headerColWidth)
        index = Math.floor(sheetX / colWidth) + 1
        if (index < 1 || index > worksheet.colCount) {
          index = null
        }
      }
      // 判断是否点在单元格区域
      else if (x >= GRID_CHROME.headerColWidth && y >= GRID_CHROME.headerRowHeight) {
        type = 'cell'
        // 单元格右键菜单：保留当前多选区域，不改变选区
      }

      if (type && (type === 'cell' || index !== null)) {
        setContextMenu({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          type,
          index,
        })
      }
    },
    [worksheet.defaultRowHeight, worksheet.defaultColWidth, worksheet.rowCount, worksheet.colCount]
  )

  // 右键菜单：复制
  const handleContextMenuCopy = useCallback(() => {
    const state = reduxStore.getState()
    const sel = state.selection
    const ws = state.workSheet
    const range = sel.range
    const cells: Record<string, { value: string; style?: (typeof ws.styles)[string] }> = {}

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
    reduxStore.dispatch(
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

    // 写入系统剪贴板
    const tsv = cellsToTSV(cells, {
      startRow: range.start.row,
      startCol: range.start.col,
      endRow: range.end.row,
      endCol: range.end.col,
    })
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).catch((err: unknown) => {
        console.warn('[GrideCanvas] Failed to write to system clipboard:', err)
      })
    }
  }, [reduxStore])

  // 右键菜单：粘贴
  const handleContextMenuPaste = useCallback(() => {
    const pasteFromClipboard = async () => {
      const state = reduxStore.getState()
      const clipboard = state.clipboard
      const ws = state.workSheet
      const sel = state.selection

      // 优先使用内部剪贴板（保留样式）
      if (clipboard.range && Object.keys(clipboard.cells).length > 0) {
        const pasteStartRow = sel.row
        const pasteStartCol = sel.col
        const rowOffset = pasteStartRow - clipboard.range.startRow
        const colOffset = pasteStartCol - clipboard.range.startCol
        const sheetId = ws.sheetId

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

          reduxStore.dispatch(
            updateCell({
              sheetId,
              row: targetRow,
              col: targetCol,
              value: (clipCell as { value: string; style?: (typeof ws.styles)[string] }).value,
              style: (clipCell as { value: string; style?: (typeof ws.styles)[string] }).style,
            })
          )
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
        const sheetId = ws.sheetId

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

          reduxStore.dispatch(
            updateCell({
              sheetId,
              row: targetRow,
              col: targetCol,
              value: (clipCell as { value: string }).value,
            })
          )
        }
      } catch (err) {
        console.warn('[GrideCanvas] System clipboard read failed:', err)
      }
    }

    pasteFromClipboard()
  }, [reduxStore])

  useCanvasInteraction({
    interactionCanvasRef: overlayCanvasRef,
    wheelTargetRef: containerRef,
    onPointerDown: (event, canvas) => {
      // 右键按下时不改变选区，保留多选状态
      if (event.button === 2) {
        return
      }
      canvas.focus()
      interactionEngine.handleCanvasPointerDown({
        currentTarget: canvas,
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: event.shiftKey,
      })
    },
    onPointerMove: (event, canvas) => {
      interactionEngine.handleCanvasPointerMove({
        currentTarget: canvas,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    },
    onPointerUp: () => {
      interactionEngine.handleCanvasPointerUp()
    },
    onPointerCancel: () => {
      interactionEngine.handleCanvasPointerUp()
    },
    onWheelScroll,
  })

  useEffect(() => {
    interactionEngine.setScroll(viewportRef.current.scrollX, viewportRef.current.scrollY)
    onScrollChange?.(viewportRef.current.scrollX, viewportRef.current.scrollY)
    publishScrollUi()
    scheduleRender(ALL_CANVAS_LAYERS)
  }, [interactionEngine, layoutVersion, onScrollChange, publishScrollUi, scheduleRender])

  useEffect(() => {
    sheetUpdatePerf.markWorksheetObserved()
    scheduleRender(ALL_CANVAS_LAYERS)
  }, [scheduleRender, worksheet.cells, worksheet.sheetId, worksheet.styles])

  // 设置自动滚动回调：当选中单元格时，自动滚动视口跟随
  useEffect(() => {
    // 获取现有的回调（由 useSpreadsheetInteraction 设置）
    const originalCallbacks = interactionEngine['callbacks'] || {}

    interactionEngine.setCallbacks({
      ...originalCallbacks,
      onAutoScroll: ({ row, col }) => {
        const viewport = viewportRef.current
        const rowHeight = worksheet.defaultRowHeight
        const colWidth = worksheet.defaultColWidth
        const headerRowHeight = GRID_CHROME.headerRowHeight
        const headerColWidth = GRID_CHROME.headerColWidth

        // 计算单元格的屏幕坐标
        const cellTop = (row - 1) * rowHeight
        const cellLeft = (col - 1) * colWidth
        const cellBottom = cellTop + rowHeight
        const cellRight = cellLeft + colWidth

        // 计算视口的数据区域（不包括表头）
        const viewportTop = viewport.scrollY
        const viewportLeft = viewport.scrollX
        const viewportBottom = viewport.scrollY + (scrollUi.dataViewportHeight - headerRowHeight)
        const viewportRight = viewport.scrollX + (scrollUi.dataViewportWidth - headerColWidth)

        let scrollX = viewport.scrollX
        let scrollY = viewport.scrollY

        // 垂直滚动：如果单元格超出视口，滚动使其可见
        if (cellTop < viewportTop) {
          scrollY = cellTop
        } else if (cellBottom > viewportBottom) {
          scrollY = cellBottom - (scrollUi.dataViewportHeight - headerRowHeight)
        }

        // 水平滚动：如果单元格超出视口，滚动使其可见
        if (cellLeft < viewportLeft) {
          scrollX = cellLeft
        } else if (cellRight > viewportRight) {
          scrollX = cellRight - (scrollUi.dataViewportWidth - headerColWidth)
        }

        // 如果需要滚动，调用 applyScroll
        if (scrollX !== viewport.scrollX || scrollY !== viewport.scrollY) {
          applyScroll(scrollX, scrollY)
        }
      },
    })
  }, [
    interactionEngine,
    worksheet.defaultRowHeight,
    worksheet.defaultColWidth,
    scrollUi,
    applyScroll,
  ])

  useEffect(() => {
    const overlayOnly: CanvasLayer[] = ['overlay']
    scheduleRender(overlayOnly)
  }, [
    scheduleRender,
    myClientId,
    selection.col,
    selection.row,
    selection.range.end.col,
    selection.range.end.row,
    selection.range.start.col,
    selection.range.start.row,
    userCursors,
    users,
    worksheet.sheetId,
  ])

  const maxScrollX = Math.max(0, scrollUi.sheetWidth - scrollUi.dataViewportWidth)
  const maxScrollY = Math.max(0, scrollUi.sheetHeight - scrollUi.dataViewportHeight)
  const canvasClass = 'absolute inset-0 h-full w-full touch-none outline-none focus:outline-none'

  return (
    <div
      className="absolute inset-0 flex flex-col bg-[#f8f9fa]"
      onClick={() => setContextMenu({ ...contextMenu, visible: false })}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <canvas ref={gridCanvasRef} className={`${canvasClass} pointer-events-none`} />
          <canvas ref={contentCanvasRef} className={`${canvasClass} pointer-events-none`} />
          <canvas
            ref={overlayCanvasRef}
            className={canvasClass}
            tabIndex={0}
            aria-label="电子表格画布"
            onDoubleClick={(event) => interactionEngine.handleCanvasDoubleClick(event)}
            onContextMenu={handleCanvasContextMenu}
            onCompositionStart={() => interactionEngine.handleCompositionStart()}
            onCompositionEnd={() => interactionEngine.handleCompositionEnd()}
          />
        </div>

        <GridScrollBar
          orientation="vertical"
          scroll={scrollUi.scrollY}
          maxScroll={maxScrollY}
          viewportSize={scrollUi.dataViewportHeight}
          contentSize={scrollUi.sheetHeight}
          onScroll={(scrollY) => applyScroll(scrollUi.scrollX, scrollY)}
        />
      </div>

      <div className="flex shrink-0">
        <GridScrollBar
          orientation="horizontal"
          scroll={scrollUi.scrollX}
          maxScroll={maxScrollX}
          viewportSize={scrollUi.dataViewportWidth}
          contentSize={scrollUi.sheetWidth}
          onScroll={(scrollX) => applyScroll(scrollX, scrollUi.scrollY)}
        />
        <div className="h-[14px] w-[14px] shrink-0 border-l border-t border-[#dadce0] bg-[#f1f3f4]" />
      </div>

      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        type={contextMenu.type}
        index={contextMenu.index}
        onClose={() => setContextMenu({ ...contextMenu, visible: false })}
        executeWithHistory={executeRowColWithHistory}
        onCopy={handleContextMenuCopy}
        onPaste={handleContextMenuPaste}
        canPaste={reduxStore.getState().clipboard.range !== undefined}
      />
    </div>
  )
}

export default forwardRef<GrideCanvasHandle, GrideCanvasProps>(GrideCanvas)
