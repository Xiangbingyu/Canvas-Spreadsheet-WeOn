// 在线用户 & 协同状态 store

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface OnlineUser {
  id: number
  docId: string
  clientId: string
  name: string
  color: string
}

export interface CollabState {
  docId: string
  clientId: string
  docTitle: string
  users: OnlineUser[]
  userCursors: Record<string, { row: number; col: number }>
  currentSeq: number
  connectionStatus: 'disconnected' | 'connected' | 'reconnecting'
}

const initialState: CollabState = {
  docId: '',
  clientId: '',
  docTitle: '',
  users: [],
  userCursors: {},
  currentSeq: 0,
  connectionStatus: 'disconnected',
}

const collabSlice = createSlice({
  name: 'collab',
  initialState,
  reducers: {
    /** 设置当前文档 ID 和客户端 ID */
    setDocSession(state, action: PayloadAction<{ docId: string; clientId: string }>) {
      state.docId = action.payload.docId
      state.clientId = action.payload.clientId
    },

    /** 更新在线用户列表 */
    setOnlineUsers(state, action: PayloadAction<OnlineUser[]>) {
      state.users = action.payload
    },

    /** 更新当前已确认的最大 seq */
    setCurrentSeq(state, action: PayloadAction<number>) {
      state.currentSeq = action.payload
    },

    /** 更新文档标题 */
    setDocTitle(state, action: PayloadAction<string>) {
      state.docTitle = action.payload
    },

    /** 更新单个用户的光标位置 */
    setUserCursor(state, action: PayloadAction<{ clientId: string; row: number; col: number }>) {
      state.userCursors[action.payload.clientId] = {
        row: action.payload.row,
        col: action.payload.col,
      }
    },

    /** 移除用户的光标（用户离开时清） */
    removeUserCursor(state, action: PayloadAction<string>) {
      delete state.userCursors[action.payload]
    },

    /** 更新连接状态 */
    setConnectionStatus(
      state,
      action: PayloadAction<'disconnected' | 'connected' | 'reconnecting'>
    ) {
      state.connectionStatus = action.payload
    },
  },
})

export const {
  setDocSession,
  setDocTitle,
  setOnlineUsers,
  setUserCursor,
  removeUserCursor,
  setCurrentSeq,
  setConnectionStatus,
} = collabSlice.actions
export const collabReducer = collabSlice.reducer
