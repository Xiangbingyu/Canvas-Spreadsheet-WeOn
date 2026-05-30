import { message } from 'antd'
import { useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, useParams } from 'react-router-dom'
import { Loading } from '@/components/Loading/Loading'
import { SpreadsheetWorkspace } from '@/components/spreadsheetLayout/SpreadsheetWorkspace'
import API, { ApiError } from '@/services/httpAPI'
import type { RootState } from '@/spreadsheet/store'
import { setWorksheet } from '@/spreadsheet/store'
import { setDocSession } from '@/spreadsheet/store/userStore'
import { allocateClientId } from '@/spreadsheet/utils/allocateClientId'
import { fromServerSnapshot } from '@/spreadsheet/utils/fromServerSnapshot'

/** 解析 URL docId，统一 GET 加载文档后组装表格 UI */
export function SpreadsheetPage() {
  const { docId: routeDocId = '' } = useParams()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const userId = useMemo(() => allocateClientId(), [])
  const storeDocId = useSelector((s: RootState) => s.collab.docId)
  const docReady = Boolean(routeDocId) && storeDocId === routeDocId

  useEffect(() => {
    if (!routeDocId || storeDocId === routeDocId) return

    let cancelled = false

    async function load() {
      try {
        const doc = await API.getDoc(routeDocId)
        if (cancelled) return
        const worksheet = fromServerSnapshot(doc.snapshot)
        dispatch(
          setWorksheet({
            ...worksheet,
            name: doc.title?.trim() || worksheet.name,
          })
        )
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
  }, [routeDocId, storeDocId, dispatch, userId, navigate])

  if (!docReady) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-white">
        <Loading visible message="正在加载文档…" />
      </div>
    )
  }

  return <SpreadsheetWorkspace />
}
