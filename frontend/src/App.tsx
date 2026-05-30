import { useEffect, useMemo, useState } from 'react'
import { StartPage } from '@/components/startUI/StartPage'
import { SpreadsheetPage } from '@/pages/SpreadsheetPage'
// import { allocateClientId } from '@/spreadsheet/utils/allocateClientId'

type View = 'start' | 'sheet'

function App() {
  const userId = useMemo(() => {
    // return allocateClientId()
    return 'system'
  }, [])

  const [view, setView] = useState<View>('start')

  // 进入表格页：push 一条历史记录，使浏览器返回键能回到文档列表而非站外首页
  function enterSheet() {
    window.history.pushState({ view: 'sheet' }, '')
    setView('sheet')
  }

  // 监听浏览器前进/返回：根据历史记录里的 state 同步 view
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const next: View = (e.state as { view?: View } | null)?.view === 'sheet' ? 'sheet' : 'start'
      setView(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (view === 'sheet') {
    return <SpreadsheetPage />
  }

  return <StartPage userId={userId} onEnterSheet={enterSheet} />
}

export default App
