import { useState } from 'react'
import { useSelector } from 'react-redux'
import { ExportExcelModal } from './ExportExcelModal'
import { ImportExcelModal } from './ImportExcelModal'
import type { RootState } from '@/spreadsheet/store'

type MenubarProps = {
  userInitial?: string
}

const menuBtnClass = 'rounded px-2 py-0.5 text-[13px] leading-6 text-[#202124] hover:bg-[#f1f3f4]'

export function Menubar({ userInitial = 'd' }: MenubarProps) {
  /** 文档标题：来自 workSheetStore.name，打开文档时由 StartPage 写入 */
  const docTitle = useSelector((s: RootState) => s.workSheet.name)
  const [title, setTitle] = useState(docTitle)
  const [prevDocTitle, setPrevDocTitle] = useState(docTitle)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  if (docTitle !== prevDocTitle) {
    setPrevDocTitle(docTitle)
    setTitle(docTitle)
  }

  return (
    <header className="shrink-0 border-b border-[#dadce0] bg-white">
      <div className="flex items-stretch gap-2 px-3 py-1.5">
        <div className="flex w-12 shrink-0 items-center justify-center self-stretch">
          <svg viewBox="0 0 24 24" className="h-10 w-10" aria-hidden>
            <path fill="#0F9D58" d="M6 2h8l6 6v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
            <path fill="#87CEAC" d="M14 2v6h6" />
            <path fill="#fff" d="M8 11h8v2H8zm0 4h8v2H8z" />
          </svg>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="文档标题"
            className="h-7 w-full min-w-0 max-w-md truncate border-0 bg-transparent text-[20px] leading-7 font-normal text-[#202124] outline-none ring-0 focus:rounded-sm focus:bg-[#f1f3f4] focus:px-2 focus:-ml-2"
          />
          <nav className="-ml-2 flex items-center gap-0.5">
            <button type="button" className={menuBtnClass} onClick={() => setImportOpen(true)}>
              导入 Excel
            </button>
            <button type="button" className={menuBtnClass} onClick={() => setExportOpen(true)}>
              导出 Excel
            </button>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-center">
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-full bg-[#c2e7ff] px-4 text-[14px] font-medium text-[#001d35] hover:bg-[#a8d5f5]"
          >
            <LockIcon />
            共享
          </button>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1a73e8] text-sm font-medium text-white"
            title="当前用户"
          >
            {userInitial}
          </div>
        </div>
      </div>

      <ImportExcelModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ExportExcelModal open={exportOpen} fileName={title} onClose={() => setExportOpen(false)} />
    </header>
  )
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-7-2a3 3 0 0 1 6 0v2h-6V6zm7 16H6V10h12v12z" />
    </svg>
  )
}
