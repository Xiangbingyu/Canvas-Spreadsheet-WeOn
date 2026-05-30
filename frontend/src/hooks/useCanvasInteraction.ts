// Canvas 交互绑定 Hook，负责指针和滚轮事件注册。
// 输入 DOM 引用与回调函数，输出自动清理的浏览器事件副作用。

import { useEffect, type RefObject } from 'react'

type UseCanvasInteractionParams = {
  interactionCanvasRef: RefObject<HTMLCanvasElement | null>
  wheelTargetRef: RefObject<HTMLElement | null>
  onPointerDown?: (event: PointerEvent, canvas: HTMLCanvasElement) => void
  onPointerMove?: (event: PointerEvent, canvas: HTMLCanvasElement) => void
  onPointerUp?: (event: PointerEvent, canvas: HTMLCanvasElement) => void
  onPointerCancel?: (event: PointerEvent, canvas: HTMLCanvasElement) => void
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
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheelScroll,
}: UseCanvasInteractionParams): void {
  useEffect(() => {
    const canvas = interactionCanvasRef.current
    if (!canvas) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      // 传入参数：pointerId 来自浏览器事件；返回结果：Canvas 在指针移出视口后仍持续接收 move/up。
      canvas.setPointerCapture(event.pointerId)
      onPointerDown?.(event, canvas)
    }

    const handlePointerMove = (event: PointerEvent) => {
      onPointerMove?.(event, canvas)
    }

    const releasePointerCapture = (event: PointerEvent) => {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      releasePointerCapture(event)
      onPointerUp?.(event, canvas)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      releasePointerCapture(event)
      onPointerCancel?.(event, canvas)
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [interactionCanvasRef, onPointerCancel, onPointerDown, onPointerMove, onPointerUp])

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
