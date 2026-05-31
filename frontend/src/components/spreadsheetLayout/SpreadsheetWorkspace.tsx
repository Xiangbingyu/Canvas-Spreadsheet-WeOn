import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import { FormulaBar } from '@/components/FormulaBar/FormulaBar'
import { Loading } from '@/components/Loading/Loading'
import { Menubar } from '@/components/Menubar/Menubar'
import { SheetTabs } from '@/components/sheetTabs/SheetTabs'
import { StatusBar } from '@/components/statusBar/StatusBar'
import { Toolbar } from '@/components/Toolbar/Toolbar'
import { CellEditOverlay } from '@/components/cellEditor/CellEditOverlay'
import GrideCanvas from '@/components/grideCanvas/GrideCanvas'
import { useSpreadsheetInteraction } from '@/hooks/useSpreadsheetInteraction'
import { useCommitCell } from '@/hooks/useCommitCell'
import { useCollab } from '@/hooks/useCollab'
import { useUnifiedHistory } from '@/hooks/useUnifiedHistory'
import type { RootState } from '@/spreadsheet/store'

/** WS 地址：开发环境走 Vite 代理 /ws → 后端 3000 */
const COLLAB_WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export function SpreadsheetWorkspace() {
  const docId = useSelector((s: RootState) => s.collab.docId)
  const clientId = useSelector((s: RootState) => s.collab.clientId)

  const { connect, disconnect, setCell, setTitle, importSheet } = useCollab({
    url: COLLAB_WS_URL,
    docId,
    clientId,
  })

  useEffect(() => {
    if (!docId) {
      disconnect()
      return
    }

    // disconnect()
    connect()

    return () => {
      disconnect()
    }
  }, [docId, clientId, connect, disconnect])

  const onCommitCell = useCommitCell(setCell)
  const { commitWithHistory, commitBatchWithHistory, undo, redo } = useUnifiedHistory(onCommitCell)

  const {
    engine,
    canvasHandleRef,
    editingCell,
    editValue,
    setEditValue,
    textareaRef,
    isComposingRef,
    textareaStyle,
    submitEdit,
    cancelEdit,
    onScrollChange,
    formulaBarValue,
  } = useSpreadsheetInteraction({ onCommitCell: commitWithHistory })

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white font-[Roboto,Arial,sans-serif]">
      <Menubar importSheet={importSheet} onSetTitle={setTitle} />
      <Toolbar
        onCommitCell={commitWithHistory}
        onCommitBatch={commitBatchWithHistory}
        onUndo={undo}
        onRedo={redo}
      />
      <FormulaBar value={formulaBarValue} onCommitCell={commitWithHistory} />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <GrideCanvas
          ref={canvasHandleRef}
          interactionEngine={engine}
          onScrollChange={onScrollChange}
        />

        <CellEditOverlay
          editingCell={editingCell}
          editValue={editValue}
          textareaRef={textareaRef}
          isComposingRef={isComposingRef}
          style={textareaStyle}
          onChange={setEditValue}
          onSubmit={submitEdit}
          onCancel={cancelEdit}
        />

        <Loading visible={false} />
      </div>

      <StatusBar />
      <SheetTabs />
    </div>
  )
}
