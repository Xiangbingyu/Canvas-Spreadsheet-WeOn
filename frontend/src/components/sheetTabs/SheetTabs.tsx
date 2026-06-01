import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { AddSheetModal } from '@/components/sheetTabs/AddSheetModal'
import type { RootState } from '@/spreadsheet/store'
import { setWorksheet, switchSheet } from '@/spreadsheet/store'
import { setSelectedCell } from '@/spreadsheet/store/selectStore'

type SheetTabsProps = {
  onAddSheet: (sheetName: string) => void
}

export function SheetTabs({ onAddSheet }: SheetTabsProps) {
  const dispatch = useDispatch()
  const [addOpen, setAddOpen] = useState(false)

  const activeSheetId = useSelector((s: RootState) => s.workbook.activeSheetId)
  const sheetOrder = useSelector((s: RootState) => s.workbook.sheetOrder)
  const sheets = useSelector((s: RootState) => s.workbook.sheets)
  const activeWorksheet = useSelector((s: RootState) => s.workSheet)

  function handleSwitch(targetSheetId: string) {
    if (targetSheetId === activeSheetId) return
    const targetSheet = sheets[targetSheetId]
    if (!targetSheet) return

    dispatch(switchSheet({ savedSheet: activeWorksheet, targetSheetId }))
    dispatch(setWorksheet(targetSheet))
    dispatch(
      setSelectedCell({
        row: 1,
        col: 1,
        value: targetSheet.cells['1:1']?.value ?? '',
        style: {},
      })
    )
  }

  function handleAddSheet(sheetName: string) {
    onAddSheet(sheetName)
  }

  return (
    <>
      <footer className="flex h-8 shrink-0 items-center border-t border-[#dadce0] bg-[#f8f9fa]">
        <button
          type="button"
          aria-label="添加工作表"
          className="flex h-8 w-8 shrink-0 items-center justify-center text-[#444746] hover:bg-[#e8eaed]"
          onClick={() => setAddOpen(true)}
        >
          +
        </button>

        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {sheetOrder.map((sheetId) => {
            const sheet = sheets[sheetId]
            if (!sheet) return null
            const isActive = sheetId === activeSheetId
            return (
              <button
                key={sheetId}
                type="button"
                onClick={() => handleSwitch(sheetId)}
                className={`flex h-8 max-w-[200px] items-center gap-1 border-r border-[#dadce0] px-3 text-[13px] ${
                  isActive
                    ? 'border-b-2 border-b-[#0b57d0] bg-white font-medium text-[#0b57d0]'
                    : 'text-[#202124] hover:bg-[#e8eaed]'
                }`}
              >
                <span className="truncate">{sheet.sheetName}</span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          aria-label="收起"
          className="flex h-8 w-8 shrink-0 items-center justify-center text-[#444746] hover:bg-[#e8eaed]"
        >
          ‹
        </button>
      </footer>

      <AddSheetModal open={addOpen} onClose={() => setAddOpen(false)} onConfirm={handleAddSheet} />
    </>
  )
}
