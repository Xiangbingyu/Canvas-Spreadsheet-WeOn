import { message } from 'antd'
import { useState } from 'react'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { CreateBlankSheetModal } from '@/components/startUI/CreateBlankSheetModal'
import API, { ApiError } from '@/services/httpAPI'
import { ExportExcelModal } from './ExportExcelModal'
import { ImportExcelModal } from './ImportExcelModal'
import type { RootState } from '@/spreadsheet/store'
import { buildDocShareUrl } from '@/spreadsheet/utils/shareLink'

type MenubarProps = {
  userInitial?: string
}

const menuBtnClass = 'rounded px-2 py-0.5 text-[13px] leading-6 text-[#202124] hover:bg-[#f1f3f4]'

export function Menubar({ userInitial = 'd' }: MenubarProps) {
  const navigate = useNavigate()
  const clientId = useSelector((s: RootState) => s.collab.clientId) || 'system'
  const docId = useSelector((s: RootState) => s.collab.docId)
  const docTitle = useSelector((s: RootState) => s.workSheet.name)
  const [title, setTitle] = useState(docTitle)
  const [prevDocTitle, setPrevDocTitle] = useState(docTitle)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  if (docTitle !== prevDocTitle) {
    setPrevDocTitle(docTitle)
    setTitle(docTitle)
  }

  async function handleShare() {
    if (!docId) {
      message.warning('请先打开文档')
      return
    }
    try {
      await navigator.clipboard.writeText(buildDocShareUrl(docId))
      message.success('复制链接成功')
    } catch {
      message.error('复制失败，请手动复制地址栏链接')
    }
  }

  async function handleCreateBlankSheet(sheetTitle: string) {
    setCreating(true)
    try {
      const doc = await API.createDoc({ title: sheetTitle, createdBy: clientId })
      console.log('[POST /docs]', doc)
      setCreateModalOpen(false)
      navigate(`/doc/${encodeURIComponent(doc.docId)}`)
    } catch (error) {
      console.log('[POST /docs] error', error)
      const text =
        error instanceof ApiError ? `${error.message} (code ${error.code})` : '创建文档失败'
      message.error(text)
    } finally {
      setCreating(false)
    }
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
            <button
              type="button"
              className={menuBtnClass}
              disabled={creating}
              onClick={() => setCreateModalOpen(true)}
            >
              新建空白表格
            </button>
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
            onClick={() => void handleShare()}
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
      <CreateBlankSheetModal
        open={createModalOpen}
        loading={creating}
        onClose={() => setCreateModalOpen(false)}
        onConfirm={(sheetTitle) => void handleCreateBlankSheet(sheetTitle)}
      />
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
