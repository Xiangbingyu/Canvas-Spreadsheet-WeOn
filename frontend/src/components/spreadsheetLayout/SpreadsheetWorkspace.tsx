import { useCallback, useEffect, useRef } from 'react'
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
import { useCommitCell, useCommitBatch } from '@/hooks/useCommitCell'
import { useCollab } from '@/hooks/useCollab'
import { useUnifiedHistory } from '@/hooks/useUnifiedHistory'
import type { RootState } from '@/spreadsheet/store'
import { addSheet as addSheetAction, setWorksheet, store } from '@/spreadsheet/store'
import type { WorkbookSnapshotPayload } from '@/spreadsheet/store/workbookStore'
import { setSelectedCell } from '@/spreadsheet/store/selectStore'

/** WS：优先 VITE_WS_URL；未配置时走 Vite 代理 /ws → 本机后端 */
const COLLAB_WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export function SpreadsheetWorkspace() {
  const dispatch = useDispatch()
  const docId = useSelector((s: RootState) => s.collab.docId)
  const clientId = useSelector((s: RootState) => s.collab.clientId)
  const connectionStatus = useSelector((s: RootState) => s.collab.connectionStatus)
  const activeWorksheet = useSelector((s: RootState) => s.workSheet)
  const selection = useSelector((s: RootState) => s.selection)
  const lastSentCursorRef = useRef('')

  const {
    connect,
    disconnect,
    setCell,
    setTitle,
    importWorkbook,
    addSheet,
    setBatchCells,
    getClient,
    sendCursor,
  } = useCollab({
    url: COLLAB_WS_URL,
    docId,
    clientId,
  })

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      lastSentCursorRef.current = ''
      return
    }

    const cursorKey = `${activeWorksheet.sheetId}:${selection.row}:${selection.col}`
    if (!activeWorksheet.sheetId || lastSentCursorRef.current === cursorKey) {
      return
    }

    sendCursor(activeWorksheet.sheetId, selection.row, selection.col)
    lastSentCursorRef.current = cursorKey
  }, [activeWorksheet.sheetId, connectionStatus, selection.row, selection.col, sendCursor])

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

  const handleAddSheet = useCallback(
    (sheetName: string) => {
      dispatch(addSheetAction({ savedSheet: activeWorksheet, sheetName }))
      const { activeSheetId, sheets } = store.getState().workbook
      const nextSheet = sheets[activeSheetId]
      if (nextSheet) {
        dispatch(setWorksheet(nextSheet))
      }
      dispatch(
        setSelectedCell({
          row: 1,
          col: 1,
          value: '',
          style: {},
        })
      )
      addSheet(sheetName)
    },
    [addSheet, dispatch, activeWorksheet]
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
  const onCommitBatch = useCommitBatch(setBatchCells)
  const { commitWithHistory, commitBatchWithHistory, executeRowColWithHistory, undo, redo } =
    useUnifiedHistory(onCommitCell, onCommitBatch, getClient())

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
      <SheetTabs onAddSheet={handleAddSheet} />
    </div>
  )
}
