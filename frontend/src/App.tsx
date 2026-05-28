import { message } from 'antd'
import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { StartPage } from '@/components/startUI/StartPage'
import { SpreadsheetPage } from '@/pages/SpreadsheetPage'
import API, { ApiError } from '@/services/httpAPI'
import { fromServerSnapshot } from '@/spreadsheet/utils/fromServerSnapshot'
import { setWorksheet, store } from '@/spreadsheet/store'

type View = 'start' | 'sheet'

function App() {
  const dispatch = useDispatch<typeof store.dispatch>()
  const [view, setView] = useState<View>('start')

  async function openDoc(docId: string) {
    try {
      const doc = await API.getDoc(docId)
      dispatch(setWorksheet(fromServerSnapshot(doc.snapshot)))
      setView('sheet')
    } catch (error) {
      const text =
        error instanceof ApiError ? `${error.message} (code ${error.code})` : '加载文档失败'
      message.error(text)
    }
  }

  if (view === 'sheet') {
    return <SpreadsheetPage />
  }

  return <StartPage onOpenDoc={openDoc} />
}

export default App
