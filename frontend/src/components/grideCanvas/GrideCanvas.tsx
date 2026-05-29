// GrideCanvas - Canvas 表格渲染容器
// 负责：视口滚动、渲染循环、把鼠标事件转发给 InteractionEngine
// InteractionEngine 由父组件创建并通过 props 注入，避免双实例冲突

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useSelector, useStore } from 'react-redux'
import { renderGrid } from '@/spreadsheet/render/gridRenderer'
import {
  clampScroll,
  getDataViewportSize,
  getSheetSize,
  type Viewport,
} from '@/spreadsheet/render/viewport'
import type { RootState } from '@/spreadsheet/store'
import type { InteractionEngine } from '@/spreadsheet/interaction/interactionEngine'

const SCROLLBAR_SIZE = 14
const MIN_THUMB_SIZE = 24

type ScrollUi = {
  scrollX: number
  scrollY: number
  dataViewportWidth: number
  dataViewportHeight: number
  sheetWidth: number
  sheetHeight: number
}

export type GrideCanvasProps = {
  interactionEngine: InteractionEngine
  /** 滚动变化时上报，父组件用于定位 textarea */
  onScrollChange?: (scrollX: number, scrollY: number) => void
}

export type GrideCanvasHandle = {
  /** 让 canvas 重新拿到焦点（提交编辑后调用，确保后续键盘事件能被命中） */
  focus: () => void
}

type GridScrollBarProps = {
  orientation: 'horizontal' | 'vertical'
  scroll: number
  maxScroll: number
  viewportSize: number
  contentSize: number
  onScroll: (value: number) => void
}

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
    (pointer: number) => {
      if (maxScroll <= 0) return

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
    [viewportSize, contentSize, scroll, maxScroll, onScroll]
  )

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (maxScroll <= 0) return
    const track = trackRef.current
    if (!track) return

    const rect = track.getBoundingClientRect()
    const pointer = isVertical ? e.clientY - rect.top : e.clientX - rect.left
    scrollFromPointer(pointer)
  }

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (maxScroll <= 0) return
    e.stopPropagation()
    dragRef.current = {
      startPointer: isVertical ? e.clientY : e.clientX,
      startScroll: scroll,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || maxScroll <= 0) return

    const { thumbSize: currentThumbSize, trackSize: currentTrackSize } = computeThumbMetrics(
      viewportSize,
      contentSize,
      scroll,
      maxScroll
    )
    const movable = Math.max(1, currentTrackSize - currentThumbSize)
    const pointer = isVertical ? e.clientY : e.clientX
    const delta = pointer - drag.startPointer
    const nextScroll = drag.startScroll + (delta / movable) * maxScroll
    onScroll(nextScroll)
  }

  const onThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
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

const GrideCanvas = forwardRef<GrideCanvasHandle, GrideCanvasProps>(function GrideCanvas(
  { interactionEngine, onScrollChange },
  ref
) {
  const reduxStore = useStore<RootState>()
  const worksheet = useSelector((s: RootState) => s.workSheet)
  const selection = useSelector((s: RootState) => s.selection)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport>({
    scrollX: 0,
    scrollY: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  })
  const rafRef = useRef<number | null>(null)
  // 把 onScrollChange 放进 ref，避免父组件每次渲染传新函数引发死循环
  const onScrollChangeRef = useRef(onScrollChange)
  useEffect(() => {
    onScrollChangeRef.current = onScrollChange
  }, [onScrollChange])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => canvasRef.current?.focus(),
    }),
    []
  )

  const [scrollUi, setScrollUi] = useState<ScrollUi>({
    scrollX: 0,
    scrollY: 0,
    dataViewportWidth: 0,
    dataViewportHeight: 0,
    sheetWidth: 0,
    sheetHeight: 0,
  })

  const publishScrollUi = useCallback(() => {
    const viewport = viewportRef.current
    const rowHeight = worksheet.defaultRowHeight
    const colWidth = worksheet.defaultColWidth
    const sheet = getSheetSize(worksheet.rowCount, worksheet.colCount, rowHeight, colWidth)

    const dataViewport = getDataViewportSize(viewport)
    const next: ScrollUi = {
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      dataViewportWidth: dataViewport.width,
      dataViewportHeight: dataViewport.height,
      sheetWidth: sheet.width,
      sheetHeight: sheet.height,
    }
    // 只有数值真的变化才 setState，避免每次都产生新对象引发死循环
    setScrollUi((prev) =>
      prev.scrollX === next.scrollX &&
      prev.scrollY === next.scrollY &&
      prev.dataViewportWidth === next.dataViewportWidth &&
      prev.dataViewportHeight === next.dataViewportHeight &&
      prev.sheetWidth === next.sheetWidth &&
      prev.sheetHeight === next.sheetHeight
        ? prev
        : next
    )

    // 同步给 engine 用于命中检测；上报给父组件用于 textarea 定位
    interactionEngine.setScroll(viewport.scrollX, viewport.scrollY)
    onScrollChangeRef.current?.(viewport.scrollX, viewport.scrollY)
  }, [worksheet, interactionEngine])

  // 绘制时从 store 读取最新数据
  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return

      const state = reduxStore.getState()
      renderGrid(ctx, {
        worksheet: state.workSheet,
        viewport: viewportRef.current,
        selection: { row: state.selection.row, col: state.selection.col },
        selectionRange: state.selection.range,
      })
    })
  }, [reduxStore])

  const applyScroll = useCallback(
    (nextX: number, nextY: number) => {
      const viewport = viewportRef.current
      const rowHeight = worksheet.defaultRowHeight
      const colWidth = worksheet.defaultColWidth
      const sheet = getSheetSize(worksheet.rowCount, worksheet.colCount, rowHeight, colWidth)

      const dataViewport = getDataViewportSize(viewport)
      const clamped = clampScroll(
        nextX,
        nextY,
        dataViewport.width,
        dataViewport.height,
        sheet.width,
        sheet.height
      )
      viewport.scrollX = clamped.scrollX
      viewport.scrollY = clamped.scrollY

      publishScrollUi()
      scheduleRender()
    },
    [worksheet, publishScrollUi, scheduleRender]
  )

  const syncLayout = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return false

    const width = Math.floor(container.clientWidth)
    const height = Math.floor(container.clientHeight)
    if (width <= 0 || height <= 0) return false

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const viewport = viewportRef.current
    viewport.viewportWidth = width
    viewport.viewportHeight = height

    const rowHeight = worksheet.defaultRowHeight
    const colWidth = worksheet.defaultColWidth
    const sheet = getSheetSize(worksheet.rowCount, worksheet.colCount, rowHeight, colWidth)
    const dataViewport = getDataViewportSize(viewport)
    const clamped = clampScroll(
      viewport.scrollX,
      viewport.scrollY,
      dataViewport.width,
      dataViewport.height,
      sheet.width,
      sheet.height
    )
    viewport.scrollX = clamped.scrollX
    viewport.scrollY = clamped.scrollY

    publishScrollUi()
    return true
  }, [worksheet, publishScrollUi])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onResize = () => {
      if (syncLayout()) scheduleRender()
    }

    const observer = new ResizeObserver(onResize)
    observer.observe(el)
    onResize()

    return () => observer.disconnect()
  }, [syncLayout, scheduleRender])

  useEffect(() => {
    if (syncLayout()) scheduleRender()
  }, [worksheet, syncLayout, scheduleRender])

  // 仅选中变化时重绘，不重复 syncLayout（避免 canvas 尺寸重置导致闪烁）
  useEffect(() => {
    scheduleRender()
  }, [
    selection.row,
    selection.col,
    selection.range.start.row,
    selection.range.start.col,
    selection.range.end.row,
    selection.range.end.col,
    scheduleRender,
  ])

  // 绑定 canvas 鼠标事件到 engine
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleMouseDown = (event: MouseEvent) => {
      // 让 canvas 拿焦点（允许接收键盘事件）
      canvas.focus()
      interactionEngine.handleCanvasPointerDown({
        currentTarget: canvas,
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: event.shiftKey,
      })
    }

    const handleMouseMove = (event: MouseEvent) => {
      interactionEngine.handleCanvasPointerMove({
        currentTarget: canvas,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    }

    const handleMouseUp = () => {
      interactionEngine.handleCanvasPointerUp()
    }

    const handleDoubleClick = (event: MouseEvent) => {
      interactionEngine.handleCanvasDoubleClick({
        currentTarget: canvas,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    }

    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('dblclick', handleDoubleClick)
    // mousemove/up 绑 window，让拖拽到 canvas 外也能跟随
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('dblclick', handleDoubleClick)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [interactionEngine])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const viewport = viewportRef.current
      applyScroll(viewport.scrollX + e.deltaX, viewport.scrollY + e.deltaY)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyScroll])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const maxScrollX = Math.max(0, scrollUi.sheetWidth - scrollUi.dataViewportWidth)
  const maxScrollY = Math.max(0, scrollUi.sheetHeight - scrollUi.dataViewportHeight)

  return (
    <div className="absolute inset-0 flex flex-col bg-[#f8f9fa]">
      <div className="flex min-h-0 min-w-0 flex-1">
        <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            tabIndex={0}
            className="block h-full w-full touch-none outline-none"
            aria-label="电子表格画布"
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
        <div
          className="shrink-0 border-l border-t border-[#dadce0] bg-[#f1f3f4]"
          style={{ width: SCROLLBAR_SIZE, height: SCROLLBAR_SIZE }}
          aria-hidden
        />
      </div>
    </div>
  )
})

export default GrideCanvas
