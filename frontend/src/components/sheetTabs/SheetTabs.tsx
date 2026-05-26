const SHEETS = ['工作表1']

export function SheetTabs() {
  return (
    <footer className="flex h-8 shrink-0 items-center border-t border-[#dadce0] bg-[#f8f9fa]">
      <button
        type="button"
        aria-label="添加工作表"
        className="flex h-8 w-8 shrink-0 items-center justify-center text-[#444746] hover:bg-[#e8eaed]"
      >
        +
      </button>
      <button
        type="button"
        aria-label="所有工作表"
        className="flex h-8 w-8 shrink-0 items-center justify-center text-[#444746] hover:bg-[#e8eaed]"
      >
        ≡
      </button>

      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {SHEETS.map((name, index) => (
          <button
            key={name}
            type="button"
            className={`flex h-8 max-w-[200px] items-center gap-1 border-r border-[#dadce0] px-3 text-[13px] ${
              index === 0
                ? 'border-b-2 border-b-[#0b57d0] bg-white font-medium text-[#0b57d0]'
                : 'text-[#202124] hover:bg-[#e8eaed]'
            }`}
          >
            {name}
            <span className="text-[10px] text-[#80868b]">▾</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="收起"
        className="flex h-8 w-8 shrink-0 items-center justify-center text-[#444746] hover:bg-[#e8eaed]"
      >
        ‹
      </button>
    </footer>
  )
}
