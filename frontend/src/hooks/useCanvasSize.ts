// Tracks a container element size with ResizeObserver for responsive canvas layout.
// Input: HTMLElement ref; output: current logical pixel width and height.
import { useLayoutEffect, useState, type RefObject } from 'react'

export interface CanvasSize {
  width: number
  height: number
}

export function useCanvasSize(ref: RefObject<HTMLElement | null>): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return undefined
    }

    const updateSize = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)

    return () => observer.disconnect()
  }, [ref])

  return size
}
