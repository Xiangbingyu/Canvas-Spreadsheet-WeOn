import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { message as antMessage } from 'antd'
import { CollabClient } from '../spreadsheet/collab/CollabClient'
import type { CollabCallbacks } from '../spreadsheet/collab/CollabClient'
import type {
  Snapshot,
  CellUpdated,
  TitleUpdated,
  CursorUpdate,
  SheetImported,
  SheetAdded,
} from '../spreadsheet/model/collabProtocol'
import {
  setWorksheet,
  updateCell,
  setDocTitle,
  setOnlineUsers,
  setUserCursor,
  setCurrentSeq,
  setConnectionStatus,
  importWorkbook as importWorkbookAction,
  applySheetAdded,
  store,
} from '@/spreadsheet/store'
import { insertRow, deleteRow, insertCol, deleteCol } from '@/spreadsheet/store/workSheetStore'
import type { WorkbookSnapshotPayload } from '@/spreadsheet/store/workbookStore'
import type { WorkbookSnapshot } from '@/services/httpType'
import {
  fromHttpDocWorkbookSnapshot,
  fromServerSnapshot,
  toServerWorkbookSnapshotFromPayload,
} from '@/spreadsheet/utils/fromServerSnapshot'
import type { Style } from '@/spreadsheet/model/types'
import type { AppDispatch, RootState } from '@/spreadsheet/store'

/** 乐观更新：先把 workbook 写入本地 Redux（Canvas 立即刷新） */
function applyLocalWorkbookImport(dispatch: AppDispatch, workbook: WorkbookSnapshotPayload) {
  dispatch(importWorkbookAction(workbook))
  const activeSheet = workbook.sheets[workbook.activeSheetId]
  if (activeSheet) {
    dispatch(setWorksheet(activeSheet))
  }
}

interface UseCollabOptions {
  url: string
  docId: string
  clientId: string
  userName?: string
  userColor?: string
}

export function useCollab({ url, docId, clientId, userName, userColor }: UseCollabOptions) {
  const dispatch = useDispatch()
  const sheetId = useSelector((s: RootState) => s.workSheet.sheetId)
  const clientRef = useRef<CollabClient | null>(null)

  const callbacks = useMemo<CollabCallbacks>(
    () => ({
      onSnapshot(snapshot: Snapshot, currentSeq: number) {
        dispatch(setWorksheet(fromServerSnapshot(snapshot)))
        dispatch(setCurrentSeq(currentSeq))
      },

      onCellUpdated(data: CellUpdated['data']) {
        dispatch(
          updateCell({
            row: data.row,
            col: data.col,
            value: data.value,
            sheetId: data.sheetId,
            style: data.style ? (data.style as Style) : undefined,
          })
        )
        dispatch(setCurrentSeq(data.seq))
      },

      onTitleUpdated(data: TitleUpdated['data']) {
        dispatch(setDocTitle(data.title))
        dispatch(setCurrentSeq(data.seq))
      },

      onSheetImported(data: SheetImported['data']) {
        // 服务端 import_sheet 确认：以服务端快照为准校正本地（乐观更新后的对齐）
        const workbook = fromHttpDocWorkbookSnapshot(data.snapshot as unknown as WorkbookSnapshot)
        applyLocalWorkbookImport(dispatch, workbook)
        dispatch(setCurrentSeq(data.seq))
      },

      onSheetAdded(data: SheetAdded['data']) {
        dispatch(
          applySheetAdded({
            sheetOrder: data.sheetOrder,
            sheet: fromServerSnapshot(
              data.sheet as unknown as Parameters<typeof fromServerSnapshot>[0]
            ),
          })
        )
        const { activeSheetId, sheets } = store.getState().workbook
        const activeSheet = sheets[activeSheetId]
        if (activeSheet && activeSheet.sheetId !== store.getState().workSheet.sheetId) {
          dispatch(setWorksheet(activeSheet))
        }
        dispatch(setCurrentSeq(data.seq))
      },

      onUndoApplied(data) {
        dispatch(
          updateCell({
            row: data.row,
            col: data.col,
            value: data.value,
            sheetId: data.sheetId,
            style: data.style ? (data.style as Style) : undefined,
          })
        )
        dispatch(setCurrentSeq(data.seq))
      },

      onRedoApplied(data) {
        dispatch(
          updateCell({
            row: data.row,
            col: data.col,
            value: data.value,
            sheetId: data.sheetId,
            style: data.style ? (data.style as Style) : undefined,
          })
        )
        dispatch(setCurrentSeq(data.seq))
      },

      onCursor(data: CursorUpdate['data']) {
        dispatch(setUserCursor({ clientId: data.clientId, row: data.row, col: data.col }))
      },

      onRowInserted(data) {
        dispatch(insertRow({ row: data.row }))
        dispatch(setCurrentSeq(data.seq))
      },

      onRowDeleted(data) {
        dispatch(deleteRow({ row: data.row }))
        dispatch(setCurrentSeq(data.seq))
      },

      onColInserted(data) {
        dispatch(insertCol({ col: data.col }))
        dispatch(setCurrentSeq(data.seq))
      },

      onColDeleted(data) {
        dispatch(deleteCol({ col: data.col }))
        dispatch(setCurrentSeq(data.seq))
      },

      onPresence(users) {
        dispatch(setOnlineUsers(users))
      },

      onError(_code) {
        if (_code === 4090) {
          antMessage.warning('文档已被他人修改，请刷新页面后重试')
        }
      },

      onConnectionChange(status) {
        dispatch(setConnectionStatus(status))
      },
    }),
    [dispatch]
  )

  const connect = useCallback(() => {
    if (clientRef.current) return
    const client = new CollabClient({ url, docId, clientId, userName, userColor, callbacks })
    clientRef.current = client
    client.connect()
  }, [url, docId, clientId, userName, userColor, callbacks])

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect()
    clientRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect()
      clientRef.current = null
    }
  }, [])

  return {
    connect,
    disconnect,
    setCell: (row: number, col: number, value: string, style?: Record<string, unknown> | null) => {
      // 乐观更新：先改本地 UI，再发 WS（离线时 UI 也有反馈）
      dispatch(
        updateCell({ row, col, value, sheetId, style: style ? (style as Style) : undefined })
      )
      const client = clientRef.current
      if (!client) return
      client.setCell(row, col, value, style ?? null, sheetId, client.currentSeq)
    },
    setTitle: (title: string) => {
      const trimmed = title.trim() || '未命名表格'
      dispatch(setDocTitle(trimmed))
      const client = clientRef.current
      if (!client) return
      client.setTitle(trimmed, client.currentSeq)
    },
    /**
     * Excel 多表导入（乐观更新）
     * 1. 先写本地 Redux → UI 立即生效
     * 2. 再发 WS import_sheet → 服务端持久化并广播
     * @returns 是否已发送到协同（false 表示仅本地更新）
     */
    importWorkbook: (workbook: WorkbookSnapshotPayload, eventId?: string): boolean => {
      applyLocalWorkbookImport(dispatch, workbook)

      const client = clientRef.current
      if (!client) return false
      client.importSheet(
        toServerWorkbookSnapshotFromPayload(workbook) as unknown as Snapshot,
        eventId
      )
      return true
    },
    sendCursor: (row: number, col: number) => clientRef.current?.sendCursor(row, col),
    addSheet: (sheetName: string): boolean => {
      const trimmed = sheetName.trim()
      if (!trimmed) return false
      const client = clientRef.current
      if (!client) return false
      client.addSheet(trimmed)
      return true
    },
    setBatchCells: (
      sheetId: string,
      updates: Array<{
        row: number
        col: number
        value: string
        style: Record<string, unknown> | null
      }>
    ) => {
      const client = clientRef.current
      if (!client) return
      client.setBatchCells(sheetId, client.currentSeq, updates)
    },
    insertRow: (sheetId: string, row: number) => {
      clientRef.current?.insertRow(sheetId, row)
    },
    deleteRow: (sheetId: string, row: number) => {
      clientRef.current?.deleteRow(sheetId, row)
    },
    insertCol: (sheetId: string, col: number) => {
      clientRef.current?.insertCol(sheetId, col)
    },
    deleteCol: (sheetId: string, col: number) => {
      clientRef.current?.deleteCol(sheetId, col)
    },
    undo: () => clientRef.current?.undo(),
    redo: () => clientRef.current?.redo(),
    getClient: () => clientRef.current ?? undefined,
  }
}
