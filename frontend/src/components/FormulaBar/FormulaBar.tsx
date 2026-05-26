type FormulaBarProps = {
  cellAddress?: string
  value?: string
}

export function FormulaBar({ cellAddress = 'A1', value = '' }: FormulaBarProps) {
  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-[#dadce0] bg-white">
      <div className="flex w-14 shrink-0 items-center justify-center border-r border-[#dadce0] text-[13px] text-[#202124]">
        {cellAddress}
      </div>
      <div className="flex w-8 shrink-0 items-center justify-center border-r border-[#dadce0] text-[13px] italic text-[#70757a]">
        fx
      </div>
      <input
        type="text"
        readOnly
        value={value}
        placeholder=""
        className="min-w-0 flex-1 bg-transparent px-2 text-[13px] text-[#202124] outline-none"
        aria-label="公式栏"
      />
    </div>
  )
}
