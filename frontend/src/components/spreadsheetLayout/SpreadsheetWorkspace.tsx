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
import type { BatchCommitFn } from '@/hooks/useCommitCell'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'
import { useCollab } from '@/hooks/useCollab'
import { ConflictDialog } from '@/components/CollabStatus/ConflictDialog'
import { useUnifiedHistory } from '@/hooks/useUnifiedHistory'
import type { RootState } from '@/spreadsheet/store'
import { addSheet as addSheetAction, setWorksheet, store } from '@/spreadsheet/store'
import { setSelectedCell } from '@/spreadsheet/store/selectStore'

/** WS：优先 VITE_WS_URL；未配置时走 Vite 代理 /ws → 本机后端 */
const COLLAB_WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export function SpreadsheetWorkspace() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [userName, setUserName] = useState('')
  const docId = useSelector((s: RootState) => s.collab.docId)
  const nameModalOpen = !!docId && !userName.trim()
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
    addSheet,
    setBatchCells,
    getClient,
    sendCursor,
    conflicts,
    resolveConflicts,
  } = useCollab({
    url: COLLAB_WS_URL,
    docId,
    clientId,
    userName: userName.trim(),
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

  // 提交后通知 Canvas 局部重绘（不写 Redux、不提交数据，仅标记脏区下一帧只重绘这些格）。
  // FormulaBar / Toolbar 不直接依赖 Canvas，由此处包一层注入 canvasHandleRef。
  const commitCellAndInvalidate = useCallback<CommitCellFn>(
    (row, col, value, style) => {
      commitWithHistory(row, col, value, style)
      canvasHandleRef.current?.invalidateCells([{ row, col }])
    },
    [commitWithHistory, canvasHandleRef]
  )

  const commitBatchAndInvalidate = useCallback<BatchCommitFn>(
    (updates) => {
      commitBatchWithHistory(updates)
      canvasHandleRef.current?.invalidateCells(updates.map(({ row, col }) => ({ row, col })))
    },
    [commitBatchWithHistory, canvasHandleRef]
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white font-[Roboto,Arial,sans-serif]">
      <DisplayNameModal
        open={nameModalOpen}
        onConfirm={setUserName}
        onCancel={() => navigate('/')}
      />
      <Menubar onSetTitle={setTitle} />
      <Toolbar
        onCommitCell={commitCellAndInvalidate}
        onCommitBatch={commitBatchAndInvalidate}
        onUndo={undo}
        onRedo={redo}
      />
      <FormulaBar value={formulaBarValue} onCommitCell={commitCellAndInvalidate} />

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
      {conflicts && (
        <ConflictDialog
          conflicts={conflicts}
          onClose={() => resolveConflicts([])}
          onResolve={resolveConflicts}
        />
      )}
    </div>
  )
}
