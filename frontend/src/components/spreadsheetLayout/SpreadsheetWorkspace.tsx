import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { DisplayNameModal } from '@/components/CollabStatus/DisplayNameModal'
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
import { setSelectedCell } from '@/spreadsheet/store/selectStore'

/** WS：优先 VITE_WS_URL；未配置时走 Vite 代理 /ws → 本机后端 */
const COLLAB_WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

type LegacySendCursor = (row: number, col: number) => void
type SheetScopedSendCursor = (sheetId: string, row: number, col: number) => void

export function SpreadsheetWorkspace() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [userName, setUserName] = useState('')
  const docId = useSelector((s: RootState) => s.collab.docId)
  const nameModalOpen = !!docId && !userName.trim()
  const clientId = useSelector((s: RootState) => s.collab.clientId)
  const activeWorksheet = useSelector((s: RootState) => s.workSheet)
  const selection = useSelector((s: RootState) => s.selection)
  const lastSentCursorRef = useRef('')

  const { connect, disconnect, setCell, setTitle, addSheet, setBatchCells, getClient, sendCursor } =
    useCollab({
      url: COLLAB_WS_URL,
      docId,
      clientId,
      userName: userName.trim(),
    })
  useEffect(() => {
    const cursorKey = `${activeWorksheet.sheetId}:${selection.row}:${selection.col}`
    if (!activeWorksheet.sheetId || lastSentCursorRef.current === cursorKey) return
    lastSentCursorRef.current = cursorKey

    if (sendCursor.length >= 3) {
      const sheetScopedSendCursor = sendCursor as unknown as SheetScopedSendCursor
      sheetScopedSendCursor(activeWorksheet.sheetId, selection.row, selection.col)
      return
    }

    const legacySendCursor = sendCursor as unknown as LegacySendCursor
    legacySendCursor(selection.row, selection.col)
  }, [activeWorksheet.sheetId, selection.row, selection.col, sendCursor])
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
    if (!docId || !userName.trim()) {
      disconnect()
      return
    }

    connect()

    return () => {
      disconnect()
    }
  }, [docId, clientId, userName, connect, disconnect])

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
      <DisplayNameModal
        open={nameModalOpen}
        onConfirm={setUserName}
        onCancel={() => navigate('/')}
      />
      <Menubar onSetTitle={setTitle} />
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

      <StatusBar awaitingDisplayName={!!docId && !userName.trim()} />
      <SheetTabs onAddSheet={handleAddSheet} />
    </div>
  )
}
