import { useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import type { RootState } from '@/spreadsheet/store'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'

type FormulaBarProps = {
  /** 网格编辑中的实时值覆盖（可选）：传入时优先显示，用于编辑态镜像 */
  value?: string
  /** 提交回调（走协同链路）。缺省时公式栏只读。 */
  onCommitCell?: CommitCellFn
}

/**
 * 公式栏：地址与值均从 selectStore 读取。
 * 支持直接在栏内编辑并提交（Enter / 失焦提交，Esc 取消），提交走 onCommitCell。
 */
export function FormulaBar({ value, onCommitCell }: FormulaBarProps) {
  const selection = useSelector((s: RootState) => s.selection)
  const address = selection.address || 'A1'
  // 外部值：网格编辑态优先用实时覆盖，否则取选中格的值
  const externalValue = value ?? selection.value ?? ''
  const editable = !!onCommitCell

  // 仅在聚焦编辑期间使用本地 draft；未聚焦时直接镜像外部值（渲染期派生，避免 effect 同步）
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayValue = focused ? draft : externalValue

  const commit = () => {
    setFocused(false)
    if (!onCommitCell) return
    if (draft === externalValue) return // 无变化不提交
    onCommitCell(selection.row, selection.col, draft, selection.style)
  }

  const cancel = () => {
    setFocused(false)
    inputRef.current?.blur()
  }

  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-[#dadce0] bg-white">
      <div className="flex w-14 shrink-0 items-center justify-center border-r border-[#dadce0] text-[13px] text-[#202124]">
        {address}
      </div>
      <div className="flex w-8 shrink-0 items-center justify-center border-r border-[#dadce0] text-[13px] italic text-[#70757a]">
        fx
      </div>
      <input
        ref={inputRef}
        type="text"
        readOnly={!editable}
        value={displayValue}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          setDraft(externalValue)
          setFocused(true)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            inputRef.current?.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        placeholder=""
        className="min-w-0 flex-1 bg-transparent px-2 text-[13px] text-[#202124] outline-none"
        aria-label="公式栏"
      />
    </div>
  )
}
