import { useEffect, useRef, useCallback } from 'react'
import { useDispatch } from 'react-redux'
import { CollabClient } from './CollabClient'
import type { CollabCallbacks } from './CollabClient'
import type { Snapshot, CellUpdated, SheetImported } from './protocol'
import {
  setWorksheet,
  updateCell,
  setOnlineUsers,
  setCurrentSeq,
  setConnectionStatus,
} from '@/spreadsheet/store'
import type { Style } from '@/spreadsheet/model/types'

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

  const callbacks: CollabCallbacks = {
    onSnapshot(snapshot: Snapshot, currentSeq: number) {
      dispatch(setWorksheet(snapshot))
      dispatch(setCurrentSeq(currentSeq))
    },

    onCellUpdated(data: CellUpdated['data']) {
      dispatch(
        updateCell({
          row: data.row,
          col: data.col,
          value: data.value,
          style: data.style as Style | undefined,
        })
      )
      dispatch(setCurrentSeq(data.seq))
    },

    onSheetImported(data: SheetImported['data']) {
      dispatch(setCurrentSeq(data.seq))
    },

    onUndoApplied(data) {
      dispatch(
        updateCell({
          row: data.row,
          col: data.col,
          value: data.value,
          style: data.style as Style | undefined,
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
          style: data.style as Style | undefined,
        })
      )
      dispatch(setCurrentSeq(data.seq))
    },

    onPresence(users) {
      dispatch(setOnlineUsers(users))
    },

    onError(code, message) {
      console.error(`[Collab] ${code}: ${message}`)
    },

    onConnectionChange(status) {
      dispatch(setConnectionStatus(status))
    },
  }

  const connect = useCallback(() => {
    if (clientRef.current) return
    const client = new CollabClient({ url, docId, clientId, userName, userColor, callbacks })
    clientRef.current = client
    client.connect()
  }, [url, docId, clientId, userName, userColor])

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect()
    clientRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect()
    }
  }, [])

  return {
    connect,
    disconnect,
    setCell: (row: number, col: number, value?: string, style?: Record<string, unknown> | null) =>
      clientRef.current?.setCell(row, col, value, style),
    importSheet: (snapshot: Snapshot, eventId?: string) =>
      clientRef.current?.importSheet(snapshot, eventId),
    undo: () => clientRef.current?.undo(),
    redo: () => clientRef.current?.redo(),
    getClient: () => clientRef.current,
  }
}
