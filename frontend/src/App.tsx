import { useMemo, useState } from 'react'
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

  if (view === 'sheet') {
    return <SpreadsheetPage />
  }

  return <StartPage userId={userId} onEnterSheet={() => setView('sheet')} />
}

export default App
