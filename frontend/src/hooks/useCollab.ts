import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { message as antMessage } from 'antd'
import type { WorkbookSnapshot } from '@/services/httpType'
import {
  CollabClient,
  type CollabCallbacks,
  type ConflictInfo,
} from '@/spreadsheet/collab/CollabClient'
import type {
  CellUpdated,
  BatchCellUpdated,
  CursorUpdate,
  SheetAdded,
  SheetImported,
  Snapshot,
  TitleUpdated,
} from '@/spreadsheet/model/collabProtocol'
import type { Style } from '@/spreadsheet/model/types'
import {
  applySheetAdded,
  importWorkbook,
  setConnectionStatus,
  setCurrentSeq,
  setDocTitle,
  setLastEditTime,
  setOnlineUsers,
  setSelf,
  setUserCursor,
  setWorksheet,
  store,
  updateCell,
  type AppDispatch,
  type RootState,
} from '@/spreadsheet/store'
import {
  deleteCol,
  deleteRow,
  insertCol,
  insertRow,
  updateRange,
} from '@/spreadsheet/store/workSheetStore'
import {
  fromHttpDocWorkbookSnapshot,
  fromServerSnapshot,
  toServerWorkbookSnapshotFromPayload,
  type WorkbookImportSnapshot,
} from '@/spreadsheet/utils/fromServerSnapshot'

interface UseCollabOptions {
  url: string
  docId: string
  clientId: string
  userName?: string
  userColor?: string
}

/** 乐观更新：workbook 快照写入 store，并按 reducer 解析后的 activeSheetId 同步 workSheet */
function applyWorkbookSnapshot(dispatch: AppDispatch, workbook: WorkbookImportSnapshot) {
  dispatch(importWorkbook(workbook))
  const { activeSheetId, sheets } = store.getState().workbook
  const activeSheet = sheets[activeSheetId]
  if (activeSheet) {
    dispatch(setWorksheet(activeSheet))
  }
}

function applyCollabSeqMeta(
  dispatch: AppDispatch,
  data: { seq: number } & Record<string, unknown>
): void {
  dispatch(setCurrentSeq(data.seq))
  if (typeof data.timestamp === 'number') dispatch(setLastEditTime(data.timestamp))
}

/** batch_cell_updated / range 回包：style 字段 → updateRange 的 style 语义 */
function styleFromServerPayload(
  style: Record<string, unknown> | null | undefined
): Style | null | undefined {
  if (style === null) return null
  if (style) return style as Style
  return undefined
}

export function useCollab({ url, docId, clientId, userName, userColor }: UseCollabOptions) {
  const dispatch = useDispatch()
  const sheetId = useSelector((s: RootState) => s.workSheet.sheetId)
  const clientRef = useRef<CollabClient | null>(null)
  const [conflicts, setConflicts] = useState<ConflictInfo[] | null>(null)

  const callbacks = useMemo<CollabCallbacks>(
    () => ({
      onSnapshot(snapshot: Snapshot, currentSeq: number) {
        const workbook = fromHttpDocWorkbookSnapshot(snapshot as WorkbookSnapshot)
        applyWorkbookSnapshot(dispatch, workbook)
        dispatch(setCurrentSeq(currentSeq))
      },

      onCellUpdated(data: CellUpdated['data']) {
        const cell = store.getState().workSheet.cells[`${data.row}:${data.col}`]
        dispatch(
          updateCell({
            row: data.row,
            col: data.col,
            value: 'value' in (data as Record<string, unknown>) ? data.value : (cell?.value ?? ''),
            sheetId: data.sheetId,
            style: data.style ? (data.style as Style) : undefined,
          })
        )
        applyCollabSeqMeta(dispatch, data as { seq: number } & Record<string, unknown>)
        // 通知在线方：别人改了我的格子
        if (data.clientId !== clientId) {
          const users = store.getState().collab.users
          const user = users.find((u) => u.clientId === data.clientId)
          const name = user?.name || data.clientId
          antMessage.info(`${name} 修改了 ${String.fromCharCode(64 + data.col)}${data.row}`)
        }
      },

      onBatchCellUpdated(data: BatchCellUpdated['data']) {
        const sheet = store.getState().workSheet
        dispatch(
          updateRange({
            sheetId: data.sheetId,
            updates: data.updates.map((u) => ({
              row: u.row,
              col: u.col,
              value:
                'value' in (u as Record<string, unknown>)
                  ? u.value
                  : (sheet.cells[`${u.row}:${u.col}`]?.value ?? ''),
              style: styleFromServerPayload(u.style),
            })),
          })
        )
        applyCollabSeqMeta(dispatch, data as { seq: number } & Record<string, unknown>)
      },

      onTitleUpdated(data: TitleUpdated['data']) {
        dispatch(setDocTitle(data.title))
        dispatch(setCurrentSeq(data.seq))
      },

      onSheetImported(data: SheetImported['data']) {
        // 服务端 import_sheet 确认：以服务端快照为准校正本地（乐观更新后的对齐）
        const workbook = fromHttpDocWorkbookSnapshot(data.snapshot as unknown as WorkbookSnapshot)
        applyWorkbookSnapshot(dispatch, workbook)
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

      onRangeValuesUpdated(data) {
        dispatch(
          updateRange({
            sheetId: data.sheetId,
            updates: data.cells.map((cell) => ({
              row: cell.row,
              col: cell.col,
              value: cell.value,
              style:
                cell.styleId && data.styles?.[cell.styleId]
                  ? (data.styles[cell.styleId] as Style)
                  : styleFromServerPayload(cell.styleId === null ? null : undefined),
            })),
          })
        )
        applyCollabSeqMeta(dispatch, data as { seq: number } & Record<string, unknown>)
      },

      onUndoApplied(data) {
        const cell = store.getState().workSheet.cells[`${data.row}:${data.col}`]
        dispatch(
          updateCell({
            row: data.row,
            col: data.col,
            value: 'value' in (data as Record<string, unknown>) ? data.value : (cell?.value ?? ''),
            sheetId: data.sheetId,
            style: data.style ? (data.style as Style) : undefined,
          })
        )
        applyCollabSeqMeta(dispatch, data as { seq: number } & Record<string, unknown>)
      },

      onRedoApplied(data) {
        const cell = store.getState().workSheet.cells[`${data.row}:${data.col}`]
        dispatch(
          updateCell({
            row: data.row,
            col: data.col,
            value: 'value' in (data as Record<string, unknown>) ? data.value : (cell?.value ?? ''),
            sheetId: data.sheetId,
            style: data.style ? (data.style as Style) : undefined,
          })
        )
        applyCollabSeqMeta(dispatch, data as { seq: number } & Record<string, unknown>)
      },

      onCursor(data: CursorUpdate['data']) {
        dispatch(
          setUserCursor({
            clientId: data.clientId,
            sheetId: data.sheetId,
            row: data.row,
            col: data.col,
          })
        )
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
        if (status === 'connected') {
          dispatch(setSelf({ name: userName ?? '', color: userColor ?? '#3b82f6' }))
        }
        if (status === 'disconnected') {
          antMessage.error('连接失败，请检查网络后刷新页面重试')
        }
      },

      onConflict(list) {
        setConflicts(list)
      },
    }),
    [dispatch, userName, userColor, clientId]
  )

  const connect = useCallback(() => {
    if (clientRef.current) return
    const client = new CollabClient({
      url,
      docId,
      clientId,
      userName,
      userColor,
      callbacks,
      readCellValue: (row, col) => store.getState().workSheet.cells[`${row}:${col}`]?.value ?? '',
    })
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
     * Excel 多表导入（乐观更新 + WS import_sheet）
     * 1. 先写本地 Redux → UI 立即生效
     * 2. 再发 WS import_sheet → 服务端持久化并广播
     * @returns 是否已发送到协同（false 表示仅本地更新）
     */
    importWorkbook: (workbook: WorkbookImportSnapshot, eventId?: string): boolean => {
      applyWorkbookSnapshot(dispatch, workbook)

      const client = clientRef.current
      if (!client) return false
      client.importSheet(
        toServerWorkbookSnapshotFromPayload(workbook) as unknown as Snapshot,
        eventId
      )
      return true
    },
    sendCursor: (sheetId: string, row: number, col: number) =>
      clientRef.current?.sendCursor(sheetId, row, col),
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
      targets: Array<{ row: number; col: number }>,
      patch: { value?: string; style?: Record<string, unknown> | null }
    ) => {
      // 乐观更新：先批量改本地 UI（一次 dispatch），再发 WS。
      // 只改样式时 patch.value 为 undefined，需保留各格原有文字（reducer 总会写入 value）。
      const sheet = store.getState().workSheet
      dispatch(
        updateRange({
          sheetId,
          updates: targets.map((t) => {
            const prev = sheet.cells[`${t.row}:${t.col}`]
            return {
              row: t.row,
              col: t.col,
              value: patch.value !== undefined ? patch.value : (prev?.value ?? ''),
              style: patch.style !== undefined ? (patch.style as Style | null) : undefined,
            }
          }),
        })
      )
      const client = clientRef.current
      if (!client) return
      client.setBatchCells(sheetId, client.currentSeq, targets, patch)
    },
    setRangeValues: (
      cells: Array<{ row: number; col: number; value?: string; styleId?: string | null }>,
      styles?: Record<string, Record<string, unknown>>
    ) => {
      const client = clientRef.current
      if (!client) return
      client.setRangeValues(sheetId, client.currentSeq, cells, styles)
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
    conflicts,
    resolveConflicts: (decisions: Array<{ row: number; col: number; keepMine: boolean }>) => {
      for (const d of decisions) {
        if (!conflicts) continue
        const c = conflicts.find((x) => x.row === d.row && x.col === d.col)
        if (!c) continue
        if (d.keepMine) {
          // 保留我的：重新发一次我的值覆盖远端
          clientRef.current?.setCell(
            c.row,
            c.col,
            c.myValue,
            c.mergedStyle as Record<string, unknown> | null,
            store.getState().workSheet.sheetId,
            clientRef.current.currentSeq
          )
        } else {
          // 保留别人的：发远端值覆盖我的 replay
          clientRef.current?.setCell(
            c.row,
            c.col,
            c.remoteValue,
            null,
            store.getState().workSheet.sheetId,
            clientRef.current.currentSeq
          )
        }
      }
      setConflicts(null)
    },
  }
}
