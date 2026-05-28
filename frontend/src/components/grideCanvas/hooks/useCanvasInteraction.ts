// React hook that binds canvas selection and wheel interactions.
// Input: DOM refs and callbacks; output: browser event side effects with cleanup.

import { useEffect, type RefObject } from 'react'
import { attachCellSelectInteraction } from '@/spreadsheet/interaction/selectCell'
import type { WorksheetData } from '@/spreadsheet/model/types'
import type { Viewport } from '@/spreadsheet/render/viewport'
import type { AppDispatch, RootState } from '@/spreadsheet/store'

type UseCanvasInteractionParams = {
  interactionCanvasRef: RefObject<HTMLCanvasElement | null>
  wheelTargetRef: RefObject<HTMLElement | null>
  getViewport: () => Viewport
  getWorksheet: () => WorksheetData
  dispatch: AppDispatch
  getState: () => RootState
  onWheelScroll: (deltaX: number, deltaY: number) => void
}

/**
 * 作用：绑定 Canvas 选择交互和滚轮滚动交互，并在卸载时清理事件。
 * 传入参数：interactionCanvasRef 为 overlayCanvas，wheelTargetRef 为滚轮容器，其余为交互模块需要的回调。
 * 返回结果：无返回值；hook 只注册事件，不修改 Redux 和业务数据。
 */
export function useCanvasInteraction({
  interactionCanvasRef,
  wheelTargetRef,
  getViewport,
  getWorksheet,
  dispatch,
  getState,
  onWheelScroll,
}: UseCanvasInteractionParams): void {
  useEffect(() => {
    const canvas = interactionCanvasRef.current
    if (!canvas) {
      return
    }

    return attachCellSelectInteraction(canvas, {
      getViewport,
      getWorksheet,
      dispatch,
      getState,
    })
  }, [dispatch, getState, getViewport, getWorksheet, interactionCanvasRef])

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
