import type { CSSProperties, RefObject } from 'react'

type CellEditOverlayProps = {
  editingCell: { row: number; col: number } | null
  editValue: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  isComposingRef: RefObject<boolean>
  style?: CSSProperties
  onChange: (value: string) => void
  onSubmit: (move?: { dr: number; dc: number; extend?: boolean }) => void
  onCancel: () => void
}

export function CellEditOverlay({
  editingCell,
  editValue,
  textareaRef,
  isComposingRef,
  style,
  onChange,
  onSubmit,
  onCancel,
}: CellEditOverlayProps) {
  if (!editingCell) return null

  return (
    <textarea
      ref={textareaRef}
      value={editValue}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (isComposingRef.current) return
        if (e.key === 'Enter') {
          e.preventDefault()
          onSubmit({ dr: e.shiftKey ? -1 : 1, dc: 0 })
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Tab') {
          e.preventDefault()
          onSubmit({ dr: 0, dc: e.shiftKey ? -1 : 1 })
        } else if (
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight'
        ) {
          e.preventDefault()
          const map: Record<string, { dr: number; dc: number }> = {
            ArrowUp: { dr: -1, dc: 0 },
            ArrowDown: { dr: 1, dc: 0 },
            ArrowLeft: { dr: 0, dc: -1 },
            ArrowRight: { dr: 0, dc: 1 },
          }
          onSubmit(map[e.key])
        }
      }}
      onBlur={() => {
        if (!isComposingRef.current) {
          onSubmit()
        }
      }}
      onCompositionStart={() => {
        isComposingRef.current = true
      }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false
        onChange((e.target as HTMLTextAreaElement).value)
      }}
      style={style}
    />
  )
}
