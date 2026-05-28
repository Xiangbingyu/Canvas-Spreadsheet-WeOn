// React hook for dirty-layer scheduling with requestAnimationFrame.
// Input: layer canvas refs and render snapshot factory; output: schedule/cancel methods.

import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { canvasPerf } from '@/spreadsheet/render/perfMonitor'
import {
  renderContentLayer,
  renderGridLayer,
  renderOverlayLayer,
  type RenderGridOptions,
} from '@/spreadsheet/render'

export type CanvasLayer = 'grid' | 'content' | 'overlay'

export const ALL_CANVAS_LAYERS: CanvasLayer[] = ['grid', 'content', 'overlay']

type CanvasLayerRefs = {
  gridCanvasRef: RefObject<HTMLCanvasElement | null>
  contentCanvasRef: RefObject<HTMLCanvasElement | null>
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>
}

type UseCanvasRenderLoopParams = CanvasLayerRefs & {
  getRenderOptions: () => RenderGridOptions
}

type CanvasLayerContexts = {
  grid: CanvasRenderingContext2D
  content: CanvasRenderingContext2D
  overlay: CanvasRenderingContext2D
}

/**
 * 作用：从三层 canvas ref 中获取 2D 绘制上下文。
 * 传入参数：refs 为 grid/content/overlay 三个 canvas ref。
 * 返回结果：成功返回三层 ctx，任一画布未就绪则返回 null。
 */
function getLayerContexts(refs: CanvasLayerRefs): CanvasLayerContexts | null {
  const grid = refs.gridCanvasRef.current?.getContext('2d')
  const content = refs.contentCanvasRef.current?.getContext('2d')
  const overlay = refs.overlayCanvasRef.current?.getContext('2d')

  if (!grid || !content || !overlay) {
    return null
  }

  return { grid, content, overlay }
}

/**
 * 作用：合并多次渲染请求，在一个 requestAnimationFrame 内只绘制 dirty 层。
 * 传入参数：三层 canvas refs，以及获取 worksheet/viewport/selection 快照的 getRenderOptions。
 * 返回结果：返回 scheduleRender 和 cancelRender；hook 不读取 Redux，不修改全局数据。
 */
export function useCanvasRenderLoop({
  gridCanvasRef,
  contentCanvasRef,
  overlayCanvasRef,
  getRenderOptions,
}: UseCanvasRenderLoopParams): {
  scheduleRender: (layers?: CanvasLayer[]) => void
  cancelRender: () => void
} {
  const rafRef = useRef<number | null>(null)
  const dirtyLayersRef = useRef<Set<CanvasLayer>>(new Set())

  const cancelRender = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    dirtyLayersRef.current.clear()
  }, [])

  const scheduleRender = useCallback(
    (layers: CanvasLayer[] = ALL_CANVAS_LAYERS) => {
      layers.forEach((layer) => dirtyLayersRef.current.add(layer))
      if (rafRef.current !== null) {
        return
      }

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null

        const dirtyLayers = new Set(dirtyLayersRef.current)
        dirtyLayersRef.current.clear()
        const contexts = getLayerContexts({ gridCanvasRef, contentCanvasRef, overlayCanvasRef })
        if (!contexts || dirtyLayers.size === 0) {
          return
        }

        const options = getRenderOptions()
        const renderStart = performance.now()

        if (dirtyLayers.has('grid')) {
          renderGridLayer(contexts.grid, options)
        }
        if (dirtyLayers.has('content')) {
          renderContentLayer(contexts.content, options)
        }
        if (dirtyLayers.has('overlay')) {
          renderOverlayLayer(contexts.overlay, options)
        }

        canvasPerf.recordRender(performance.now() - renderStart)
      })
    },
    [contentCanvasRef, getRenderOptions, gridCanvasRef, overlayCanvasRef]
  )

  useEffect(() => cancelRender, [cancelRender])

  return { scheduleRender, cancelRender }
}
