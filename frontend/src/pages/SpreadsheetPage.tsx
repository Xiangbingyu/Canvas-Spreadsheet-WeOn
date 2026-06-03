import { message } from 'antd'
import { useEffect, useMemo } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate, useParams } from 'react-router-dom'
import { SpreadsheetWorkspace } from '@/components/spreadsheetLayout/SpreadsheetWorkspace'
import API, { ApiError } from '@/services/httpAPI'
import { initFromDoc, setDocTitle, setWorksheet } from '@/spreadsheet/store'
import { setDocSession } from '@/spreadsheet/store/userStore'
import { allocateClientId } from '@/spreadsheet/utils/allocateClientId'
import { fromHttpDocWorkbookSnapshot } from '@/spreadsheet/utils/fromServerSnapshot'

/** 解析 URL docId，统一 GET 加载文档后组装表格 UI */
export function SpreadsheetPage() {
  const { docId: routeDocId = '' } = useParams()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const userId = useMemo(() => allocateClientId(), [])

  useEffect(() => {
    if (!routeDocId) return

    let cancelled = false
    // 先绑定路由 docId，避免 navigate 后 WS 仍连旧文档
    dispatch(setDocSession({ docId: routeDocId, clientId: userId }))

    async function load() {
      try {
        const doc = await API.getDoc(routeDocId)
        if (cancelled) return
        const workbook = fromHttpDocWorkbookSnapshot(doc.snapshot)
        const docTitle = doc.title?.trim() || '未命名表格'
        dispatch(initFromDoc({ docTitle, ...workbook }))
        const activeSheet = workbook.sheets[workbook.activeSheetId]
        if (activeSheet) {
          dispatch(setWorksheet(activeSheet))
        }
        dispatch(setDocTitle(docTitle))
        dispatch(setDocSession({ docId: doc.docId, clientId: userId }))
      } catch (error) {
        if (cancelled) return
        const text =
          error instanceof ApiError ? `${error.message} (code ${error.code})` : '加载文档失败'
        message.error(text)
        navigate('/')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [routeDocId, dispatch, userId, navigate])

  return <SpreadsheetWorkspace />
}
