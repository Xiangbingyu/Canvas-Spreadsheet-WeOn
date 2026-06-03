import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { message as antMessage } from 'antd'
import { CollabClient } from '../spreadsheet/collab/CollabClient'
import type { CollabCallbacks, ConflictInfo } from '../spreadsheet/collab/CollabClient'
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
  setSelf,
  setLastEditTime,
  importWorkbook as importWorkbookAction,
  applySheetAdded,
  store,
} from '@/spreadsheet/store'
import {
  insertRow,
  deleteRow,
  insertCol,
  deleteCol,
  updateRange,
  setRangeValues as setRangeValuesAction,
} from '@/spreadsheet/store/workSheetStore'
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
  const [conflicts, setConflicts] = useState<ConflictInfo[] | null>(null)

  const callbacks = useMemo<CollabCallbacks>(
    () => ({
      onSnapshot(snapshot: Snapshot, currentSeq: number) {
        dispatch(setWorksheet(fromServerSnapshot(snapshot)))
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
        dispatch(setCurrentSeq(data.seq))
        const raw = data as Record<string, unknown>
        if (typeof raw.timestamp === 'number') dispatch(setLastEditTime(raw.timestamp))
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

      onRangeValuesUpdated(data) {
        // 关键：用服务端 transform 后的最终 cells 更新 store，不用本地请求的坐标。
        // 整批走一次原子 setRangeValues（样式池化 styleId 引用），避免逐格 dispatch
        // ——粘贴上万格时 N 次 dispatch 会触发 N 次订阅通知 + N 帧重绘，导致页面卡死。
        dispatch(
          setRangeValuesAction({
            sheetId: data.sheetId,
            styles: data.styles as Record<string, Style> | undefined,
            cells: data.cells,
          })
        )
        dispatch(setCurrentSeq(data.seq))
        const raw = data as Record<string, unknown>
        if (typeof raw.timestamp === 'number') dispatch(setLastEditTime(raw.timestamp))
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
        dispatch(setCurrentSeq(data.seq))
        const raw = data as Record<string, unknown>
        if (typeof raw.timestamp === 'number') dispatch(setLastEditTime(raw.timestamp))
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
        dispatch(setCurrentSeq(data.seq))
        const raw = data as Record<string, unknown>
        if (typeof raw.timestamp === 'number') dispatch(setLastEditTime(raw.timestamp))
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
        if (status === 'failed') {
          antMessage.error('连接失败，请检查网络后刷新页面重试')
        }
      },

      onConflict(list) {
        setConflicts(list)
      },
    }),
    [dispatch, userName, userColor]
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
     * Excel 多表导入（乐观更新 + WS import_sheet）
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
      styles?: Record<string, Style>
    ) => {
      if (cells.length === 0) return
      // 乐观局部更新：先按请求 cells 即时写本地（一次原子 dispatch，Canvas 立即重绘），
      // 再发 WS。与 setCell/setBatchCells 同一套「本地先行、广播对齐」模式——撤回/重做、
      // 粘贴按下即时有反应，消除「等服务端往返才变」的卡顿感。
      // 广播 onRangeValuesUpdated 回来时按服务端 transform 后的最终 cells 覆盖（幂等），
      // 行列并发等情形以广播为准，乐观值被纠正。
      dispatch(setRangeValuesAction({ sheetId, styles, cells }))
      const client = clientRef.current
      if (!client) return
      // 适配层：内部用领域类型 Style，发往 WS 客户端时按其通用 Record 签名透传。
      client.setRangeValues(
        sheetId,
        client.currentSeq,
        cells,
        styles as Record<string, Record<string, unknown>> | undefined
      )
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
        if (d.keepMine && conflicts) {
          const c = conflicts.find((x) => x.row === d.row && x.col === d.col)
          if (c) {
            clientRef.current?.setCell(
              c.row,
              c.col,
              c.myValue,
              c.mergedStyle as Record<string, unknown> | null,
              store.getState().workSheet.sheetId,
              clientRef.current.currentSeq
            )
          }
        }
        // 保留别人的：不动（远端值已在 store 中）
      }
      setConflicts(null)
    },
  }
}
