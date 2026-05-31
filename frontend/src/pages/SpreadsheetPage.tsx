import { message } from 'antd'
import { useEffect, useMemo } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate, useParams } from 'react-router-dom'
import { SpreadsheetWorkspace } from '@/components/spreadsheetLayout/SpreadsheetWorkspace'
import API, { ApiError } from '@/services/httpAPI'
import { initFromDoc, setDocTitle, setWorksheet } from '@/spreadsheet/store'
import { setDocSession } from '@/spreadsheet/store/userStore'
import { allocateClientId } from '@/spreadsheet/utils/allocateClientId'
import { fromServerSnapshot } from '@/spreadsheet/utils/fromServerSnapshot'

/** 解析 URL docId，统一 GET 加载文档后组装表格 UI */
export function SpreadsheetPage() {
  const { docId: routeDocId = '' } = useParams()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const userId = useMemo(() => allocateClientId(), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const doc = await API.getDoc(routeDocId)
        if (cancelled) return
        const worksheet = fromServerSnapshot(doc.snapshot)
        const docTitle = doc.title?.trim() || '未命名表格'
        dispatch(initFromDoc({ docTitle, worksheet }))
        dispatch(setWorksheet(worksheet))
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
