// React hook for dirty-layer scheduling with requestAnimationFrame.
// Input: dirty layers and render callback; output: schedule/cancel methods.

import { useCallback, useEffect, useRef } from 'react'

export type CanvasLayer = 'grid' | 'content' | 'overlay'

export const ALL_CANVAS_LAYERS: CanvasLayer[] = ['grid', 'content', 'overlay']

type UseCanvasRenderLoopParams = {
  onRender: (layers: Set<CanvasLayer>) => void
}

/**
 * 作用：合并多次渲染请求，在一个 requestAnimationFrame 内输出 dirty 层集合。
 * 传入参数：onRender 为调用方提供的绘制回调，hook 不获取 Canvas 上下文。
 * 返回结果：返回 scheduleRender 和 cancelRender；hook 不读取 Redux，不修改全局数据。
 */
export function useCanvasRenderLoop({ onRender }: UseCanvasRenderLoopParams): {
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

        if (dirtyLayers.size > 0) {
          onRender(dirtyLayers)
        }
      })
    },
    [onRender]
  )

  useEffect(() => cancelRender, [cancelRender])

  return { scheduleRender, cancelRender }
}
