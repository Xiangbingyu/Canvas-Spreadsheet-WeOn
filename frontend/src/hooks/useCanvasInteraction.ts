// Canvas 交互绑定 Hook，负责指针和滚轮事件注册。
// 输入 DOM 引用与回调函数，输出自动清理的浏览器事件副作用。

import { useEffect, type RefObject } from 'react'

type UseCanvasInteractionParams = {
  interactionCanvasRef: RefObject<HTMLCanvasElement | null>
  wheelTargetRef: RefObject<HTMLElement | null>
  onPointerDown?: (event: PointerEvent, canvas: HTMLCanvasElement) => void
  onWheelScroll: (deltaX: number, deltaY: number) => void
}

/**
 * 作用：绑定 Canvas 指针事件和滚轮滚动事件，并在卸载时清理事件。
 * 传入参数：interactionCanvasRef 为 overlayCanvas，wheelTargetRef 为滚轮容器，onPointerDown/onWheelScroll 为调用方回调。
 * 返回结果：无返回值；hook 只注册 DOM 事件，不命中单元格、不修改 Redux 数据。
 */
export function useCanvasInteraction({
  interactionCanvasRef,
  wheelTargetRef,
  onPointerDown,
  onWheelScroll,
}: UseCanvasInteractionParams): void {
  useEffect(() => {
    const canvas = interactionCanvasRef.current
    if (!canvas) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      onPointerDown?.(event, canvas)
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    return () => canvas.removeEventListener('pointerdown', handlePointerDown)
  }, [interactionCanvasRef, onPointerDown])

  useEffect(() => {
    const el = wheelTargetRef.current
    if (!el) {
      return
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      onWheelScroll(event.deltaX, event.deltaY)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheelScroll, wheelTargetRef])
}
