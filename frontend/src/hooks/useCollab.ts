import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useDispatch } from 'react-redux'
import { message } from 'antd'
import { CollabClient } from '../spreadsheet/collab/CollabClient'
import type { CollabCallbacks } from '../spreadsheet/collab/CollabClient'
import type {
  Snapshot,
  CellUpdated,
  TitleUpdated,
  SheetImported,
} from '../spreadsheet/model/collabProtocol'
import {
  setWorksheet,
  updateCell,
  setDocTitle,
  setOnlineUsers,
  setCurrentSeq,
  setConnectionStatus,
} from '@/spreadsheet/store'
import { fromServerSnapshot, toServerSnapshot } from '@/spreadsheet/utils/fromServerSnapshot'
import type { Style, WorksheetData } from '@/spreadsheet/model/types'

interface UseCollabOptions {
  url: string
  docId: string
  clientId: string
  userName?: string
  userColor?: string
}

export function useCollab({ url, docId, clientId, userName, userColor }: UseCollabOptions) {
  const dispatch = useDispatch()
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
        dispatch(setWorksheet(fromServerSnapshot(data.snapshot)))
        dispatch(setCurrentSeq(data.seq))
      },

      onUndoApplied(data) {
        dispatch(
          updateCell({
            row: data.row,
            col: data.col,
            value: data.value,
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
            style: data.style ? (data.style as Style) : undefined,
          })
        )
        dispatch(setCurrentSeq(data.seq))
      },

      onPresence(users) {
        dispatch(setOnlineUsers(users))
      },

      onError(code) {
        if (code === 4090) {
          message.warning('文档已被他人修改，请刷新页面后重试')
        }
        console.error(`[Collab] code=${code}`)
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
    setCell: (row: number, col: number, value: string, style: Record<string, unknown> | null) => {
      const client = clientRef.current
      if (!client) return
      client.setCell(row, col, value, style, client.currentSeq)
    },
    setTitle: (title: string) => {
      const trimmed = title.trim() || '未命名表格'
      dispatch(setDocTitle(trimmed))
      const client = clientRef.current
      if (!client) return
      client.setTitle(trimmed, client.currentSeq)
    },
    importSheet: (worksheet: WorksheetData, eventId?: string): boolean => {
      dispatch(setWorksheet(worksheet))
      const client = clientRef.current
      if (!client) return false
      client.importSheet(toServerSnapshot(worksheet) as Snapshot, eventId)
      return true
    },
    undo: () => clientRef.current?.undo(),
    redo: () => clientRef.current?.redo(),
    getClient: () => clientRef.current,
  }
}
