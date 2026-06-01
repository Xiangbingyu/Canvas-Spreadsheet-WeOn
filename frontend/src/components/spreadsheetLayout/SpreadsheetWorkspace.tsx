import { useCallback, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
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
import type { WorkbookSnapshotPayload } from '@/spreadsheet/store/workbookStore'
import { setSelectedCell } from '@/spreadsheet/store/selectStore'

/** WS 地址：开发环境走 Vite 代理 /ws → 后端 3000 */
const COLLAB_WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export function SpreadsheetWorkspace() {
  const dispatch = useDispatch()
  const docId = useSelector((s: RootState) => s.collab.docId)
  const clientId = useSelector((s: RootState) => s.collab.clientId)

  const { connect, disconnect, setCell, setTitle, importWorkbook, getClient } = useCollab({
    url: COLLAB_WS_URL,
    docId,
    clientId,
  })

  const handleImportWorkbook = useCallback(
    (workbook: WorkbookSnapshotPayload): boolean => {
      const sent = importWorkbook(workbook)
      const activeSheet = workbook.sheets[workbook.activeSheetId]
      if (activeSheet) {
        dispatch(
          setSelectedCell({
            row: 1,
            col: 1,
            value: activeSheet.cells['1:1']?.value ?? '',
            style: {},
          })
        )
      }
      return sent
    },
    [importWorkbook, dispatch]
  )

  useEffect(() => {
    if (!docId) {
      disconnect()
      return
    }

    connect()

    return () => {
      disconnect()
    }
  }, [docId, clientId, connect, disconnect])

  const onCommitCell = useCommitCell(setCell)
  const { commitWithHistory, commitBatchWithHistory, executeRowColWithHistory, undo, redo } =
    useUnifiedHistory(onCommitCell, getClient())

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
      <Menubar onImportWorkbook={handleImportWorkbook} onSetTitle={setTitle} />
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
          executeRowColWithHistory={executeRowColWithHistory}
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
