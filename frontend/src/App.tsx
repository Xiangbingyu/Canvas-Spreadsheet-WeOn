import { SpreadsheetPage } from '@/pages/SpreadsheetPage'
import { store } from '@/spreadsheet/store'
import { Provider } from 'react-redux'

function App() {
  return (
    <Provider store={store}>
      <SpreadsheetPage />
    </Provider>
  )
}

export default App
