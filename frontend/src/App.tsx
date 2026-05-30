import { useMemo } from 'react'
import { Route, Routes } from 'react-router-dom'
import { StartPage } from '@/components/startUI/StartPage'
import { SpreadsheetPage } from '@/pages/SpreadsheetPage'
import { allocateClientId } from '@/spreadsheet/utils/allocateClientId'

function App() {
  const userId = useMemo(() => allocateClientId(), [])

  return (
    <Routes>
      {/* 文档列表 */}
      <Route path="/" element={<StartPage userId={userId} />} />

      {/* 文档页（带 ID） */}
      <Route path="/doc/:docId" element={<SpreadsheetPage />} />
    </Routes>
  )
}

export default App
