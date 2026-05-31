import { useCallback } from 'react'

export interface ContextMenuProps {
  visible: boolean
  x: number
  y: number
  type: 'row' | 'col' | null
  index: number | null
  onClose: () => void
  executeWithHistory?: (
    action: 'insert_row' | 'delete_row' | 'insert_col' | 'delete_col',
    index: number
  ) => void
}

export function ContextMenu({
  visible,
  x,
  y,
  type,
  index,
  onClose,
  executeWithHistory,
}: ContextMenuProps) {
  const handleInsert = useCallback(() => {
    if (index === null) return
    if (type === 'row') {
      executeWithHistory?.('insert_row', index)
    } else if (type === 'col') {
      executeWithHistory?.('insert_col', index)
    }
    onClose()
  }, [executeWithHistory, type, index, onClose])

  const handleDelete = useCallback(() => {
    if (index === null) return
    if (type === 'row') {
      executeWithHistory?.('delete_row', index)
    } else if (type === 'col') {
      executeWithHistory?.('delete_col', index)
    }
    onClose()
  }, [executeWithHistory, type, index, onClose])

  if (!visible || type === null || index === null) {
    return null
  }

  const isRow = type === 'row'
  const insertLabel = isRow ? '插入行' : '插入列'
  const deleteLabel = isRow ? '删除行' : '删除列'

  return (
    <div
      className="fixed z-50 min-w-32 rounded border border-[#dadce0] bg-white shadow-lg"
      style={{ left: `${x}px`, top: `${y}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="block w-full px-4 py-2 text-left text-sm hover:bg-[#f0f4f9]"
        onClick={handleInsert}
      >
        {insertLabel}
      </button>
      <button
        className="block w-full px-4 py-2 text-left text-sm hover:bg-[#f0f4f9]"
        onClick={handleDelete}
      >
        {deleteLabel}
      </button>
    </div>
  )
}
