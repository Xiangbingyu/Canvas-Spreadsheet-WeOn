// Layered Canvas spreadsheet component that connects Redux data to renderer hooks.
// Input: worksheet/selection from store; output: grid, content, and overlay canvases.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector, useStore } from 'react-redux'
import {
  createViewport,
  getDataViewportSize,
  getSheetSize,
  clampScroll,
} from '@/spreadsheet/render'
import type { Viewport } from '@/spreadsheet/render'
import type { AppDispatch, RootState } from '@/spreadsheet/store'
import {
  ALL_CANVAS_LAYERS,
  useCanvasRenderLoop,
  type CanvasLayer,
} from './hooks/useCanvasRenderLoop'
import { useCanvasInteraction } from './hooks/useCanvasInteraction'
import { useLayeredCanvas, type LayeredCanvasLayout } from './hooks/useLayeredCanvas'

const MIN_THUMB_SIZE = 24

type ScrollUi = {
  scrollX: number
  scrollY: number
  dataViewportWidth: number
  dataViewportHeight: number
  sheetWidth: number
  sheetHeight: number
}

type GridScrollBarProps = {
  orientation: 'horizontal' | 'vertical'
  scroll: number
  maxScroll: number
  viewportSize: number
  contentSize: number
  onScroll: (value: number) => void
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
function GrideCanvas() {
  const dispatch = useDispatch<AppDispatch>()
  const reduxStore = useStore<RootState>()
  const worksheet = useSelector((state: RootState) => state.workSheet)
  const selection = useSelector((state: RootState) => state.selection)
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
      selection: { row: state.selection.row, col: state.selection.col },
    }
  }, [reduxStore])

  const { scheduleRender } = useCanvasRenderLoop({
    gridCanvasRef,
    contentCanvasRef,
    overlayCanvasRef,
    getRenderOptions,
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
     * 作用：应用横向/纵向滚动，限制边界后触发全层重绘。
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

      viewport.scrollX = clamped.scrollX
      viewport.scrollY = clamped.scrollY
      publishScrollUi()
      scheduleRender(ALL_CANVAS_LAYERS)
    },
    [
      layout.colCount,
      layout.colWidth,
      layout.rowCount,
      layout.rowHeight,
      publishScrollUi,
      scheduleRender,
    ]
  )

  const getViewport = useCallback(() => viewportRef.current, [])
  const getWorksheet = useCallback(() => reduxStore.getState().workSheet, [reduxStore])
  const getState = useCallback(() => reduxStore.getState(), [reduxStore])
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

  useCanvasInteraction({
    interactionCanvasRef: overlayCanvasRef,
    wheelTargetRef: containerRef,
    getViewport,
    getWorksheet,
    dispatch,
    getState,
    onWheelScroll,
  })

  useEffect(() => {
    publishScrollUi()
    scheduleRender(ALL_CANVAS_LAYERS)
  }, [layoutVersion, publishScrollUi, scheduleRender])

  useEffect(() => {
    scheduleRender(ALL_CANVAS_LAYERS)
  }, [scheduleRender, worksheet])

  useEffect(() => {
    const overlayOnly: CanvasLayer[] = ['overlay']
    scheduleRender(overlayOnly)
  }, [scheduleRender, selection.col, selection.row])

  const maxScrollX = Math.max(0, scrollUi.sheetWidth - scrollUi.dataViewportWidth)
  const maxScrollY = Math.max(0, scrollUi.sheetHeight - scrollUi.dataViewportHeight)
  const canvasClass = 'absolute inset-0 h-full w-full touch-none'

  return (
    <div className="absolute inset-0 flex flex-col bg-[#f8f9fa]">
      <div className="flex min-h-0 min-w-0 flex-1">
        <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <canvas ref={gridCanvasRef} className={`${canvasClass} pointer-events-none`} />
          <canvas ref={contentCanvasRef} className={`${canvasClass} pointer-events-none`} />
          <canvas ref={overlayCanvasRef} className={canvasClass} aria-label="电子表格画布" />
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
    </div>
  )
}

export default GrideCanvas
