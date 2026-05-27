// ===== 消息类型 =====
// 参考: ignore_协同实现/接口文档.md v1

export type ClientMessageType = 'join' | 'set_cell' | 'import_sheet' | 'presence' | 'undo' | 'redo'

export type ServerMessageType =
  | 'join_ack'
  | 'cell_updated'
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
  value?: string
  style?: Record<string, unknown> | null
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

export interface SheetImported {
  type: 'sheet_imported'
  code: 0
  message: 'ok'
  data: {
    docId: string
    clientId: string
    seq: number
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
  code: number // 4000 | 4001 | 4003 | 4004 | 5000
  message: string
  data: null
}

export type WsResponse =
  | JoinAck
  | CellUpdated
  | SheetImported
  | PresenceMessage
  | UndoApplied
  | RedoApplied
  | ErrorMessage

// ===== 数据结构 =====

export interface Snapshot {
  id: string
  name: string
  defaultRowHeight: number
  defaultColWidth: number
  rowCount: number
  colCount: number
  styles: Record<string, CellStyle>
  cells: Record<string, Cell> // key: "row:col" 0-indexed
}

export interface Cell {
  row: number // 0-indexed
  col: number // 0-indexed
  value: string
  styleId: string | null
}

export interface CellStyle {
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  bgColor?: string
  hAlign?: 'left' | 'center' | 'right'
}

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
  INTERNAL_ERROR: 5000,
} as const
