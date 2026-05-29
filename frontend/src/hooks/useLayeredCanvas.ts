// React hook for layered canvas refs, DPR sizing, and resize observation.
// Input: sheet layout metrics and viewport ref; output: DOM refs and layout version.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  clampScroll,
  getDataViewportSize,
  getSheetSize,
  type Viewport,
} from '@/spreadsheet/render/viewport'

export type LayeredCanvasLayout = {
  rowCount: number
  colCount: number
  rowHeight: number
  colWidth: number
}

export type LayeredCanvasRefs = {
  containerRef: RefObject<HTMLDivElement | null>
  gridCanvasRef: RefObject<HTMLCanvasElement | null>
  contentCanvasRef: RefObject<HTMLCanvasElement | null>
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>
}

type UseLayeredCanvasParams = {
  layout: LayeredCanvasLayout
  viewportRef: RefObject<Viewport>
}

/**
 * 作用：同步单个 canvas 的 bitmap 尺寸和 CSS 尺寸；不获取 Canvas 上下文。
 * 传入参数：canvas 为目标画布，width/height 为逻辑像素，dpr 为设备像素比。
 * 返回结果：无返回值；调用方需要在绘制前自行设置 ctx transform。
 */
function syncCanvasElementSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number
): void {
  canvas.width = Math.max(1, Math.floor(width * dpr))
  canvas.height = Math.max(1, Math.floor(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
}

/**
 * 作用：管理 grid/content/overlay 三层 Canvas 的 ref、DPR 尺寸和 resize 同步。
 * 传入参数：layout 为行列尺寸信息，viewportRef 为共享视口。
 * 返回结果：返回容器和三层 canvas refs、layoutVersion，以及可手动调用的 syncLayout。
 */
export function useLayeredCanvas({
  layout,
  viewportRef,
}: UseLayeredCanvasParams): LayeredCanvasRefs & {
  layoutVersion: number
  syncLayout: () => boolean
} {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridCanvasRef = useRef<HTMLCanvasElement>(null)
  const contentCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const [layoutVersion, setLayoutVersion] = useState(0)

  const syncLayout = useCallback(() => {
    const container = containerRef.current
    const canvases = [gridCanvasRef.current, contentCanvasRef.current, overlayCanvasRef.current]
    if (!container || canvases.some((canvas) => canvas === null)) {
      return false
    }

    const width = Math.floor(container.clientWidth)
    const height = Math.floor(container.clientHeight)
    if (width <= 0 || height <= 0) {
      return false
    }

    const dpr = window.devicePixelRatio || 1
    canvases.forEach((canvas) => syncCanvasElementSize(canvas!, width, height, dpr))

    const viewport = viewportRef.current
    viewport.viewportWidth = width
    viewport.viewportHeight = height

    const sheet = getSheetSize(layout.rowCount, layout.colCount, layout.rowHeight, layout.colWidth)
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
    return true
  }, [layout.colCount, layout.colWidth, layout.rowCount, layout.rowHeight, viewportRef])

  const notifyLayoutChange = useCallback(() => {
    setLayoutVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }

    const onResize = () => {
      if (syncLayout()) {
        notifyLayoutChange()
      }
    }

    const observer = new ResizeObserver(onResize)
    observer.observe(el)
    onResize()

    return () => observer.disconnect()
  }, [notifyLayoutChange, syncLayout])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (syncLayout()) {
        notifyLayoutChange()
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [notifyLayoutChange, syncLayout])

  return {
    containerRef,
    gridCanvasRef,
    contentCanvasRef,
    overlayCanvasRef,
    layoutVersion,
    syncLayout,
  }
}
