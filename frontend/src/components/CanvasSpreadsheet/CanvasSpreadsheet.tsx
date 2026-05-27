// React shell for the spreadsheet canvas; adapts DOM events to interaction callbacks.
// Rendering is delegated to spreadsheet/renderer and data comes from the page/store layer.
// Input: CanvasSpreadsheetProps; output: canvas rendering plus interaction callback events.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { useCanvasSize } from '@/hooks/useCanvasSize'
import {
  DEFAULT_CONFIG,
  type SelectionRange,
  type Style,
  type ViewportState,
} from '@/spreadsheet/model/types'
import type { CanvasSpreadsheetProps as InteractionCanvasSpreadsheetProps } from '@/spreadsheet/interaction/interaction'
import { renderSpreadsheet } from '@/spreadsheet/renderer/renderer'
import { getTotalSize } from '@/spreadsheet/renderer/viewport'
import { getCellAtPoint, getSheetHitTarget } from '@/spreadsheet/utils/coordinate'
import { normalizeRange } from '@/spreadsheet/utils/range'

type DragMode = 'cell' | 'row' | 'column'

interface ActiveDrag {
  mode: DragMode
  start: { row: number; col: number }
}

export interface CanvasSpreadsheetProps extends InteractionCanvasSpreadsheetProps {
  styles?: Record<string, Style>
  onViewportChange?: (viewport: ViewportState) => void
}

export function CanvasSpreadsheet({
  rowCount,
  colCount,
  cells,
  styles,
  selection,
  editingCell,
  config,
  callbacks,
  className,
  style,
  onViewportChange,
}: CanvasSpreadsheetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const lastPointerPointRef = useRef<{ x: number; y: number } | null>(null)
  const pendingScrollRef = useRef({ scrollX: 0, scrollY: 0 })
  const renderFrameRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const autoScrollFrameRef = useRef<number | null>(null)
  const selectionRef = useRef(selection)
  const size = useCanvasSize(containerRef)
  const resolvedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config])
  const totalSize = useMemo(
    () => getTotalSize(rowCount, colCount, resolvedConfig),
    [colCount, resolvedConfig, rowCount]
  )
  const [scrollOffset, setScrollOffset] = useState({
    scrollX: 0,
    scrollY: 0,
  })
  const viewportWidth = Math.max(0, size.width - 16)
  const viewportHeight = Math.max(0, size.height - 16)
  const viewport = useMemo<ViewportState>(
    () => ({
      scrollX: scrollOffset.scrollX,
      scrollY: scrollOffset.scrollY,
      width: viewportWidth,
      height: viewportHeight,
    }),
    [scrollOffset.scrollX, scrollOffset.scrollY, viewportHeight, viewportWidth]
  )
  const viewportRef = useRef(viewport)

  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    onViewportChange?.(viewport)
  }, [onViewportChange, viewport])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
      }
    }
  }, [])

  const draw = useCallback(
    (renderViewport = viewportRef.current, renderSelection = selectionRef.current) => {
      const canvas = canvasRef.current
      if (!canvas || renderViewport.width <= 0 || renderViewport.height <= 0) {
        return
      }

      const dpr = window.devicePixelRatio || 1
      const bitmapWidth = Math.max(1, Math.floor(renderViewport.width * dpr))
      const bitmapHeight = Math.max(1, Math.floor(renderViewport.height * dpr))

      if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
        canvas.width = bitmapWidth
        canvas.height = bitmapHeight
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderSpreadsheet({
        ctx,
        width: renderViewport.width,
        height: renderViewport.height,
        rowCount,
        colCount,
        cells,
        styles,
        selection: renderSelection,
        editingCell,
        viewport: renderViewport,
        config: resolvedConfig,
      })
    },
    [cells, colCount, editingCell, resolvedConfig, rowCount, styles]
  )

  useEffect(() => {
    if (renderFrameRef.current !== null) {
      window.cancelAnimationFrame(renderFrameRef.current)
    }

    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null
      draw()
    })

    return () => {
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current)
      }
    }
  }, [draw])

  const getCoordFromEvent = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement> | ReactPointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      return getCellAtPoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        viewport,
        resolvedConfig,
        rowCount,
        colCount
      )
    },
    [colCount, resolvedConfig, rowCount, viewport]
  )

  const getPointFromNativeEvent = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }, [])

  const getSelectionForDragPoint = useCallback(
    (drag: ActiveDrag, point: { x: number; y: number }, sourceViewport = viewportRef.current) => {
      const coord = getCellAtPoint(
        point.x,
        point.y,
        sourceViewport,
        resolvedConfig,
        rowCount,
        colCount,
        { clampToViewport: true }
      )

      if (!coord) {
        return null
      }

      if (drag.mode === 'column') {
        return normalizeRange({
          start: { row: 0, col: drag.start.col },
          end: { row: rowCount - 1, col: coord.col },
        })
      }

      if (drag.mode === 'row') {
        return normalizeRange({
          start: { row: drag.start.row, col: 0 },
          end: { row: coord.row, col: colCount - 1 },
        })
      }

      return normalizeRange({ start: drag.start, end: coord })
    },
    [colCount, resolvedConfig, rowCount]
  )

  const updateSelectionFromPointer = useCallback(
    (event: MouseEvent) => {
      const drag = activeDragRef.current
      const point = getPointFromNativeEvent(event)
      if (!drag || !point) {
        return
      }

      lastPointerPointRef.current = point
      const newSelection = getSelectionForDragPoint(drag, point)
      if (newSelection) {
        callbacks.onSelectionChange?.({ newSelection, reason: 'mouse' })
      }
    },
    [callbacks, getPointFromNativeEvent, getSelectionForDragPoint]
  )

  const commitSelection = useCallback(
    (newSelection: SelectionRange) => {
      selectionRef.current = newSelection
      draw(viewportRef.current, newSelection)
      callbacks.onSelectionChange?.({ newSelection, reason: 'mouse' })
    },
    [callbacks, draw]
  )

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current)
      autoScrollFrameRef.current = null
    }
  }, [])

  const startAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      return
    }

    const tick = () => {
      const scrollElement = scrollRef.current
      const point = lastPointerPointRef.current
      const drag = activeDragRef.current

      if (!scrollElement || !point || !drag) {
        autoScrollFrameRef.current = null
        return
      }

      const threshold = 32
      const maxStep = 24
      const currentViewport = viewportRef.current
      const horizontalPressure =
        drag.mode === 'row'
          ? 0
          : point.x < threshold
            ? point.x - threshold
            : point.x > currentViewport.width - threshold
              ? point.x - (currentViewport.width - threshold)
              : 0
      const verticalPressure =
        drag.mode === 'column'
          ? 0
          : point.y < threshold
            ? point.y - threshold
            : point.y > currentViewport.height - threshold
              ? point.y - (currentViewport.height - threshold)
              : 0

      if (horizontalPressure !== 0 || verticalPressure !== 0) {
        scrollElement.scrollLeft += Math.max(-maxStep, Math.min(maxStep, horizontalPressure))
        scrollElement.scrollTop += Math.max(-maxStep, Math.min(maxStep, verticalPressure))
        const nextViewport = {
          ...viewportRef.current,
          scrollX: scrollElement.scrollLeft,
          scrollY: scrollElement.scrollTop,
        }
        viewportRef.current = nextViewport
        pendingScrollRef.current = {
          scrollX: nextViewport.scrollX,
          scrollY: nextViewport.scrollY,
        }
        setScrollOffset(pendingScrollRef.current)
        const newSelection = getSelectionForDragPoint(drag, point, nextViewport)
        if (newSelection) {
          selectionRef.current = newSelection
          draw(nextViewport, newSelection)
          callbacks.onSelectionChange?.({ newSelection, reason: 'mouse' })
        }
        autoScrollFrameRef.current = window.requestAnimationFrame(tick)
        return
      }

      autoScrollFrameRef.current = null
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(tick)
  }, [callbacks, draw, getSelectionForDragPoint])

  const syncScrollFromElement = useCallback(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    const nextViewport = {
      ...viewportRef.current,
      scrollX: element.scrollLeft,
      scrollY: element.scrollTop,
    }

    viewportRef.current = nextViewport
    pendingScrollRef.current = {
      scrollX: nextViewport.scrollX,
      scrollY: nextViewport.scrollY,
    }
    setScrollOffset(pendingScrollRef.current)
    draw(nextViewport, selectionRef.current)
  }, [draw])

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    pendingScrollRef.current = {
      scrollX: element.scrollLeft,
      scrollY: element.scrollTop,
    }

    if (scrollFrameRef.current !== null) {
      return
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      syncScrollFromElement()
    })
  }, [syncScrollFromElement])

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      const element = scrollRef.current
      if (!element) {
        return
      }

      element.scrollLeft += event.deltaX
      element.scrollTop += event.deltaY
      syncScrollFromElement()
      event.preventDefault()
    },
    [syncScrollFromElement]
  )

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const coord = getCoordFromEvent(event)
      if (coord) {
        callbacks.onCellDoubleClick?.({ coord, event: event.nativeEvent })
      }
    },
    [callbacks, getCoordFromEvent]
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)

      const rect = event.currentTarget.getBoundingClientRect()
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const target = getSheetHitTarget(
        point.x,
        point.y,
        viewport,
        resolvedConfig,
        rowCount,
        colCount
      )

      lastPointerPointRef.current = point

      if (target.type === 'cell') {
        activeDragRef.current = { mode: 'cell', start: target.coord }
        callbacks.onCellMouseDown?.({ coord: target.coord, event: event.nativeEvent })
        callbacks.onCellClick?.({ coord: target.coord, event: event.nativeEvent })
        commitSelection({ start: target.coord, end: target.coord })
      } else if (target.type === 'column-header') {
        activeDragRef.current = { mode: 'column', start: { row: 0, col: target.col } }
        commitSelection({
          start: { row: 0, col: target.col },
          end: { row: rowCount - 1, col: target.col },
        })
      } else if (target.type === 'row-header') {
        activeDragRef.current = { mode: 'row', start: { row: target.row, col: 0 } }
        commitSelection({
          start: { row: target.row, col: 0 },
          end: { row: target.row, col: colCount - 1 },
        })
      } else if (target.type === 'corner') {
        activeDragRef.current = null
        commitSelection({
          start: { row: 0, col: 0 },
          end: { row: rowCount - 1, col: colCount - 1 },
        })
      } else {
        activeDragRef.current = null
        callbacks.onCanvasClick?.({ event: event.nativeEvent })
      }
    },
    [callbacks, colCount, commitSelection, resolvedConfig, rowCount, viewport]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = getPointFromNativeEvent(event.nativeEvent)
      if (point) {
        lastPointerPointRef.current = point
      }

      startAutoScroll()

      const coord = getCoordFromEvent(event)
      if (coord) {
        callbacks.onCellMouseMove?.({ coord, event: event.nativeEvent })
      }

      const drag = activeDragRef.current
      if (drag && point) {
        const newSelection = getSelectionForDragPoint(drag, point)
        if (newSelection) {
          commitSelection(newSelection)
        }
      }
    },
    [
      callbacks,
      commitSelection,
      getCoordFromEvent,
      getPointFromNativeEvent,
      getSelectionForDragPoint,
      startAutoScroll,
    ]
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      stopAutoScroll()
      updateSelectionFromPointer(event.nativeEvent)

      const coord = getCoordFromEvent(event)
      activeDragRef.current = null
      lastPointerPointRef.current = null

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      if (coord) {
        callbacks.onCellMouseUp?.({ coord, event: event.nativeEvent })
      }
    },
    [callbacks, getCoordFromEvent, stopAutoScroll, updateSelectionFromPointer]
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      callbacks.onKeyboard?.({
        event: event.nativeEvent,
        currentSelection: selection,
      })
    },
    [callbacks, selection]
  )

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-[#f8f9fa] ${className ?? ''}`}
      style={style}
    >
      <div ref={scrollRef} className="absolute inset-0 z-0 overflow-auto" onScroll={handleScroll}>
        <div
          style={{
            width: Math.max(totalSize.width, size.width),
            height: Math.max(totalSize.height, size.height),
          }}
        />
      </div>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="absolute bottom-4 left-0 right-4 top-0 z-[2] block bg-white outline-none"
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        aria-label="Canvas spreadsheet"
      />
    </div>
  )
}

CanvasSpreadsheet.displayName = 'CanvasSpreadsheet'
