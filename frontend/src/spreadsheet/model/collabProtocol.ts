// ===== 消息类型 =====
// 消息字段对齐: docs/接口文档.md v1
// 数据结构对齐: @/spreadsheet/model/types.ts

import type { Cell, Style, WorksheetData } from '@/spreadsheet/model/types'

// 类型别名，保持 WS 消息定义可读
export type Snapshot = WorksheetData
export type CellStyle = Style
export type { Cell }

export type ClientMessageType =
  | 'join'
  | 'set_cell'
  | 'set_title'
  | 'cursor'
  | 'import_sheet'
  | 'presence'
  | 'undo'
  | 'redo'

export type ServerMessageType =
  | 'join_ack'
  | 'cell_updated'
  | 'title_updated'
  | 'cursor_update'
  | 'sheet_imported'
  | 'presence'
  | 'undo_applied'
  | 'redo_applied'
  | 'error'

// ===== 客户端 → 服务端 =====

export interface JoinRequest {
  type: 'join'
  docId: string
  clientId: string
  name?: string
  color?: string
}

export interface SetCellRequest {
  type: 'set_cell'
  docId: string
  clientId: string
  row: number // 1-indexed
  col: number // 1-indexed
  value: string
  style: Record<string, unknown> | null
  baseSeq: number
}

export interface SetTitleRequest {
  type: 'set_title'
  docId: string
  clientId: string
  title: string
  baseSeq: number
}

export interface CursorRequest {
  type: 'cursor'
  docId: string
  clientId: string
  row: number
  col: number
}

export interface ImportSheetRequest {
  type: 'import_sheet'
  docId: string
  clientId: string
  snapshot: Snapshot
  eventId?: string
}

export interface UndoRequest {
  type: 'undo'
  docId: string
  clientId: string
}

export interface RedoRequest {
  type: 'redo'
  docId: string
  clientId: string
}

export type WsRequest =
  | JoinRequest
  | SetCellRequest
  | SetTitleRequest
  | CursorRequest
  | ImportSheetRequest
  | UndoRequest
  | RedoRequest

// ===== 服务端 → 客户端 =====

export interface JoinAck {
  type: 'join_ack'
  code: 0
  message: 'ok'
  data: {
    docId: string
    clientId: string
    currentSeq: number
    snapshot: Snapshot
    users: UserInfo[]
  }
}

export interface CellUpdated {
  type: 'cell_updated'
  code: 0
  message: 'ok'
  data: {
    docId: string
    clientId: string
    seq: number
    row: number // 1-indexed
    col: number // 1-indexed
    value: string
    style: Record<string, unknown> | null
    canUndo: boolean
    canRedo: boolean
  }
}

export interface TitleUpdated {
  type: 'title_updated'
  code: 0
  message: 'ok'
  data: {
    docId: string
    clientId: string
    seq: number
    title: string
  }
}

export interface CursorUpdate {
  type: 'cursor_update'
  code: 0
  message: 'ok'
  data: {
    docId: string
    clientId: string
    row: number
    col: number
  }
}

export interface SheetImported {
  type: 'sheet_imported'
  code: 0
  message: 'ok'
  data: {
    docId: string
    clientId: string
    seq: number
    snapshot: Snapshot
    canUndo: boolean
    canRedo: boolean
  }
}

export interface UndoApplied {
  type: 'undo_applied'
  code: 0
  message: 'ok'
  data: {
    docId: string
    clientId: string
    seq: number
    row: number
    col: number
    value: string
    style: Record<string, unknown> | null
    canUndo: boolean
    canRedo: boolean
  }
}

export interface RedoApplied {
  type: 'redo_applied'
  code: 0
  message: 'ok'
  data: CellUpdated['data']
}

export interface PresenceMessage {
  type: 'presence'
  code: 0
  message: 'ok'
  data: {
    docId: string
    users: UserInfo[]
  }
}

export interface ErrorMessage {
  type: 'error'
  code: number // 4000 | 4001 | 4003 | 4004 | 4090 | 5000
  message: string
  data: null
}

export type WsResponse =
  | JoinAck
  | CellUpdated
  | TitleUpdated
  | CursorUpdate
  | SheetImported
  | PresenceMessage
  | UndoApplied
  | RedoApplied
  | ErrorMessage

// ===== 用户信息（collab 专用） =====

export interface UserInfo {
  id: number
  docId: string
  clientId: string
  name: string
  color: string
  status: 'online'
  joinedAt: string
  lastActiveAt: string
}

// ===== 错误码 =====

export const ERROR_CODES = {
  OK: 0,
  INVALID_PARAMS: 4000,
  UNSUPPORTED_MESSAGE_TYPE: 4001,
  FORBIDDEN: 4003,
  DOCUMENT_NOT_FOUND: 4004,
  CONFLICT: 4090,
  INTERNAL_ERROR: 5000,
} as const
