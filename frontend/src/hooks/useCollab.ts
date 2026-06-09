import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { message as antMessage } from 'antd'
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
  TitleUpdated,
} from '@/spreadsheet/model/collabProtocol'
import type { Style, WorkbookData } from '@/spreadsheet/model/types'
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
  wireWorkbookToWorkbook,
  wireSheetToWorksheet,
  workbookToWireWorkbook,
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

function toCellLabel(row: number, col: number): string {
  let label = ''
  let c = col
  while (c > 0) {
    c--
    label = String.fromCharCode(65 + (c % 26)) + label
    c = Math.floor(c / 26)
  }
  return `${label}${row}`
}

export function useCollab({ url, docId, clientId, userName, userColor }: UseCollabOptions) {
  const dispatch = useDispatch()
  const sheetId = useSelector((s: RootState) => s.workSheet.sheetId)
  const clientRef = useRef<CollabClient | null>(null)
  const [conflicts, setConflicts] = useState<ConflictInfo[] | null>(null)

  // Bug 4: 追踪刚重连/新加入的用户，为他们的回放操作显示通知
  const prevOnlineIdsRef = useRef<Set<string>>(new Set())
  const recentlyJoinedRef = useRef<
    Map<string, { name: string; timer: ReturnType<typeof setTimeout> }>
  >(new Map())

  const callbacks = useMemo<CollabCallbacks>(
    () => ({
      onSnapshot(snapshot: WorkbookData, currentSeq: number) {
        const workbook = wireWorkbookToWorkbook(snapshot)
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
        // Bug 4: 刚重连用户回放离线操作时显示通知
        if (data.clientId !== clientId) {
          const joined = recentlyJoinedRef.current.get(data.clientId)
          if (joined) {
            antMessage.info(`${joined.name} 修改了 ${toCellLabel(data.row, data.col)}`)
          }
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
        // Bug 4: 刚重连用户批量回放通知
        if (data.clientId !== clientId && data.updates.length > 0) {
          const joined = recentlyJoinedRef.current.get(data.clientId)
          if (joined) {
            const cells = data.updates.map((u) => toCellLabel(u.row, u.col)).join('、')
            antMessage.info(`${joined.name} 批量修改了 ${cells}`)
          }
        }
      },

      onTitleUpdated(data: TitleUpdated['data']) {
        dispatch(setDocTitle(data.title))
        dispatch(setCurrentSeq(data.seq))
      },

      onSheetImported(data: SheetImported['data']) {
        // 服务端 import_sheet 确认：以服务端快照为准校正本地（乐观更新后的对齐）
        const workbook = wireWorkbookToWorkbook(data.snapshot)
        applyWorkbookSnapshot(dispatch, workbook)
        dispatch(setCurrentSeq(data.seq))
      },

      onSheetAdded(data: SheetAdded['data']) {
        dispatch(
          applySheetAdded({
            sheetOrder: data.sheetOrder,
            sheet: wireSheetToWorksheet(data.sheet as Parameters<typeof wireSheetToWorksheet>[0]),
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
        if (data.clientId !== clientId) {
          const joined = recentlyJoinedRef.current.get(data.clientId)
          if (joined) antMessage.info(`${joined.name} 撤销了 ${toCellLabel(data.row, data.col)}`)
        }
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
        if (data.clientId !== clientId) {
          const joined = recentlyJoinedRef.current.get(data.clientId)
          if (joined) antMessage.info(`${joined.name} 重做了 ${toCellLabel(data.row, data.col)}`)
        }
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
        if (data.clientId !== clientId) {
          const joined = recentlyJoinedRef.current.get(data.clientId)
          if (joined) antMessage.info(`${joined.name} 在第 ${data.row} 行前插入了一行`)
        }
      },

      onRowDeleted(data) {
        dispatch(deleteRow({ row: data.row }))
        dispatch(setCurrentSeq(data.seq))
        if (data.clientId !== clientId) {
          const joined = recentlyJoinedRef.current.get(data.clientId)
          if (joined) antMessage.info(`${joined.name} 删除了第 ${data.row} 行`)
        }
      },

      onColInserted(data) {
        dispatch(insertCol({ col: data.col }))
        dispatch(setCurrentSeq(data.seq))
        if (data.clientId !== clientId) {
          const joined = recentlyJoinedRef.current.get(data.clientId)
          const colLabel = String.fromCharCode(64 + data.col)
          if (joined) antMessage.info(`${joined.name} 在 ${colLabel} 列前插入了一列`)
        }
      },

      onColDeleted(data) {
        dispatch(deleteCol({ col: data.col }))
        dispatch(setCurrentSeq(data.seq))
        if (data.clientId !== clientId) {
          const joined = recentlyJoinedRef.current.get(data.clientId)
          const colLabel = String.fromCharCode(64 + data.col)
          if (joined) antMessage.info(`${joined.name} 删除了 ${colLabel} 列`)
        }
      },

      onPresence(users) {
        const prevIds = prevOnlineIdsRef.current
        const currentIds = new Set(users.map((u) => u.clientId))
        // 检测新加入/重连的用户（在 presence 列表里但之前不在）
        for (const u of users) {
          if (!prevIds.has(u.clientId) && u.clientId !== clientId) {
            const joined = recentlyJoinedRef.current
            if (joined.has(u.clientId)) {
              clearTimeout(joined.get(u.clientId)!.timer)
            }
            const timer = setTimeout(() => {
              joined.delete(u.clientId)
            }, 5000)
            joined.set(u.clientId, { name: u.name, timer })
          }
        }
        prevOnlineIdsRef.current = currentIds
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
      getRemoteUserName: () => {
        const { users, clientId: selfId } = store.getState().collab
        const other = users.find((u) => u.clientId !== selfId)
        return other?.name || '在线协作方'
      },
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
      client.importSheet(workbookToWireWorkbook(workbook), eventId)
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
      targetSheetId: string,
      cells: Array<{ row: number; col: number; value: string; styleId?: string | null }>,
      styles?: Record<string, Record<string, unknown>>
    ) => {
      // 乐观更新：与 setBatchCells 对称，先 updateRange 再发 WS
      const sheet = store.getState().workSheet
      dispatch(
        updateRange({
          sheetId: targetSheetId,
          updates: cells.map((c) => {
            let style: Style | null | undefined
            if ('styleId' in c) {
              if (c.styleId === null) {
                style = null
              } else if (c.styleId && styles?.[c.styleId]) {
                style = styles[c.styleId] as Style
              } else if (c.styleId && sheet.styles[c.styleId]) {
                style = sheet.styles[c.styleId]
              } else {
                style = null
              }
            }
            return {
              row: c.row,
              col: c.col,
              value: c.value,
              style,
            }
          }),
        })
      )
      const client = clientRef.current
      if (!client) return
      client.setRangeValues(targetSheetId, client.currentSeq, cells, styles)
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
