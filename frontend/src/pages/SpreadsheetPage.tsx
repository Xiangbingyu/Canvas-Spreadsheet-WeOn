import { FormulaBar } from '@/components/FormulaBar/FormulaBar'
import { Loading } from '@/components/Loading/Loading'
import { Menubar } from '@/components/Menubar/Menubar'
import { SheetTabs } from '@/components/sheetTabs/SheetTabs'
import { StatusBar } from '@/components/statusBar/StatusBar'
import { Toolbar } from '@/components/Toolbar/Toolbar'
import { SpreadsheetGrid } from '@/pages/SpreadsheetGrid'

export function SpreadsheetPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white font-[Roboto,Arial,sans-serif]">
      <Menubar />
      <Toolbar />
      <FormulaBar cellAddress="A1" value="" />

      <div className="relative min-h-0 flex-1">
        <SpreadsheetGrid activeCell="A1" />
        <Loading visible={false} />
      </div>

      <StatusBar onlineCount={3} userName="演示用户" />
      <SheetTabs />
    </div>
  )
}
