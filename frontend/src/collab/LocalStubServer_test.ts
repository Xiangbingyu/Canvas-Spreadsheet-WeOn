/**
 * 本地协同模拟器
 *
 * 不依赖后端，在浏览器内存中模拟 WebSocket 房间行为。
 * 通过 CollabClient 的 onSend 回调拦截所有发出的消息，处理后用 receiveMessage 喂回结果。
 *
 * 使用:
 *   const server = new LocalStubServer()
 *   const alice = server.createClient('u1', 'Alice', '#f00', callbacks)
 *   alice.setCell(1, 1, 'hello')
 */

import { CollabClient } from './CollabClient'
import type { CollabCallbacks } from './CollabClient'
import type {
  Snapshot,
  UserInfo,
  JoinRequest,
  SetCellRequest,
  ImportSheetRequest,
  UndoRequest,
  RedoRequest,
  WsResponse,
} from './protocol'
import type { Style } from '@/spreadsheet/model/types'
import { findOrCreateStyleId } from '@/spreadsheet/utils/generateStyleId'

// ============================================================
//  类型
// ============================================================

interface StubClientEntry {
  client: CollabClient
  clientId: string
  name: string
  color: string
}

interface CellUpdatedEntry {
  row: number
  col: number
  oldValue: string
  oldStyle: Record<string, unknown> | null
  newValue: string
  newStyle: Record<string, unknown> | null
}

// ============================================================
//  LocalStubServer
// ============================================================

export class LocalStubServer {
  private seq = 0
  private clients = new Map<string, StubClientEntry>()
  private snapshot: Snapshot
  private undoStacks = new Map<string, CellUpdatedEntry[]>()
  private redoStacks = new Map<string, CellUpdatedEntry[]>()
  private counter = 0

  constructor() {
    this.snapshot = this.emptySnapshot()
  }

  // ---- 公开 API ----

  createClient(
    clientId: string,
    name: string,
    color: string,
    callbacks: CollabCallbacks
  ): CollabClient {
    const connId = `${clientId}_${++this.counter}`

    const client = new CollabClient({
      url: 'stub://local',
      docId: 'doc_stub_001',
      clientId,
      userName: name,
      userColor: color,
      callbacks,
      reconnectInterval: 999999, // stub 模式不需要重连
      onSend: (msg) => this.handleMessage(connId, msg),
    })

    this.clients.set(connId, { client, clientId, name, color })

    // 模拟连接成功 → 自动 join
    setTimeout(() => {
      callbacks.onConnectionChange('connected')
      this.handleMessage(connId, {
        type: 'join',
        docId: 'doc_stub_001',
        clientId,
        name,
        color,
      })
    }, 0)

    return client
  }

  // ---- 消息路由 ----

  private handleMessage(connId: string, msg: Record<string, unknown>): void {
    switch (msg.type as string) {
      case 'join':
        return this.handleJoin(connId, msg as unknown as JoinRequest)
      case 'set_cell':
        return this.handleSetCell(connId, msg as unknown as SetCellRequest)
      case 'import_sheet':
        return this.handleImportSheet(connId, msg as unknown as ImportSheetRequest)
      case 'undo':
        return this.handleUndo(connId, msg as unknown as UndoRequest)
      case 'redo':
        return this.handleRedo(connId, msg as unknown as RedoRequest)
    }
  }

  // ---- 各消息处理 ----

  private handleJoin(connId: string, msg: JoinRequest): void {
    const entry = this.clients.get(connId)
    if (!entry) return

    const existing = [...this.clients.values()].filter((c) => c.clientId === msg.clientId)

    this.reply(connId, {
      type: 'join_ack',
      code: 0,
      message: 'ok',
      data: {
        docId: msg.docId,
        clientId: msg.clientId,
        currentSeq: this.seq,
        snapshot: JSON.parse(JSON.stringify(this.snapshot)),
        users: this.getUsers(),
      },
    })

    if (existing.length === 1) {
      this.broadcast(this.presenceMsg())
    }
  }

  private handleSetCell(connId: string, msg: SetCellRequest): void {
    this.seq++

    const cellKey = `${msg.row - 1}:${msg.col - 1}`
    const oldCell = this.snapshot.cells[cellKey]
    const oldValue = oldCell?.value ?? ''
    const oldStyle = oldCell?.styleId ? this.snapshot.styles[oldCell.styleId] : null

    // style → styleId
    let styleId: string | null = null
    if (msg.style) {
      styleId = findOrCreateStyleId(this.snapshot.styles, msg.style as Style)
    }

    this.snapshot.cells[cellKey] = {
      row: msg.row - 1,
      col: msg.col - 1,
      value: msg.value ?? '',
      styleId,
    }

    // undo 栈
    const stackKey = `${msg.docId}:${msg.clientId}`
    const undoStack = this.undoStacks.get(stackKey) ?? []
    undoStack.push({
      row: msg.row,
      col: msg.col,
      oldValue,
      oldStyle: oldStyle as Record<string, unknown> | null,
      newValue: msg.value ?? '',
      newStyle: msg.style ?? null,
    })
    this.undoStacks.set(stackKey, undoStack)
    this.redoStacks.set(stackKey, [])

    const payload: WsResponse = {
      type: 'cell_updated',
      code: 0,
      message: 'ok',
      data: {
        docId: msg.docId,
        clientId: msg.clientId,
        seq: this.seq,
        row: msg.row,
        col: msg.col,
        value: msg.value ?? '',
        style: msg.style ?? null,
        canUndo: true,
        canRedo: false,
      },
    }

    this.reply(connId, payload)
    this.broadcast(payload)
  }

  private handleImportSheet(connId: string, msg: ImportSheetRequest): void {
    this.seq++
    this.snapshot = JSON.parse(JSON.stringify(msg.snapshot))
    this.undoStacks.clear()
    this.redoStacks.clear()

    const payload: WsResponse = {
      type: 'sheet_imported',
      code: 0,
      message: 'ok',
      data: {
        docId: msg.docId,
        clientId: msg.clientId,
        seq: this.seq,
        canUndo: false,
        canRedo: false,
      },
    }

    this.reply(connId, payload)
    this.broadcast(payload)
  }

  private handleUndo(connId: string, msg: UndoRequest): void {
    const stackKey = `${msg.docId}:${msg.clientId}`
    const undoStack = this.undoStacks.get(stackKey) ?? []

    if (undoStack.length === 0) {
      this.reply(connId, { type: 'error', code: 4000, message: 'nothing to undo', data: null })
      return
    }

    const entry = undoStack.pop()!
    this.seq++

    const cellKey = `${entry.row - 1}:${entry.col - 1}`
    let styleId: string | null = null
    if (entry.oldStyle) {
      styleId = findOrCreateStyleId(this.snapshot.styles, entry.oldStyle as Style)
    }
    this.snapshot.cells[cellKey] = {
      row: entry.row - 1,
      col: entry.col - 1,
      value: entry.oldValue,
      styleId,
    }

    const redoStack = this.redoStacks.get(stackKey) ?? []
    redoStack.push(entry)
    this.redoStacks.set(stackKey, redoStack)

    const payload: WsResponse = {
      type: 'undo_applied',
      code: 0,
      message: 'ok',
      data: {
        docId: msg.docId,
        clientId: msg.clientId,
        seq: this.seq,
        row: entry.row,
        col: entry.col,
        value: entry.oldValue,
        style: entry.oldStyle,
        canUndo: undoStack.length > 0,
        canRedo: true,
      },
    }

    this.reply(connId, payload)
    this.broadcast(payload)
  }

  private handleRedo(connId: string, msg: RedoRequest): void {
    const stackKey = `${msg.docId}:${msg.clientId}`
    const redoStack = this.redoStacks.get(stackKey) ?? []

    if (redoStack.length === 0) {
      this.reply(connId, { type: 'error', code: 4000, message: 'nothing to redo', data: null })
      return
    }

    const entry = redoStack.pop()!
    this.seq++

    const cellKey = `${entry.row - 1}:${entry.col - 1}`
    let styleId: string | null = null
    if (entry.newStyle) {
      styleId = findOrCreateStyleId(this.snapshot.styles, entry.newStyle as Style)
    }
    this.snapshot.cells[cellKey] = {
      row: entry.row - 1,
      col: entry.col - 1,
      value: entry.newValue,
      styleId,
    }

    const undoStack = this.undoStacks.get(stackKey) ?? []
    undoStack.push(entry)
    this.undoStacks.set(stackKey, undoStack)

    const payload: WsResponse = {
      type: 'redo_applied',
      code: 0,
      message: 'ok',
      data: {
        docId: msg.docId,
        clientId: msg.clientId,
        seq: this.seq,
        row: entry.row,
        col: entry.col,
        value: entry.newValue,
        style: entry.newStyle,
        canUndo: true,
        canRedo: redoStack.length > 0,
      },
    }

    this.reply(connId, payload)
    this.broadcast(payload)
  }

  // ---- 工具 ----

  private reply(connId: string, msg: WsResponse): void {
    this.clients.get(connId)?.client.receiveMessage(msg)
  }

  private broadcast(msg: WsResponse): void {
    for (const entry of this.clients.values()) {
      entry.client.receiveMessage(msg)
    }
  }

  private presenceMsg(): WsResponse {
    return {
      type: 'presence',
      code: 0,
      message: 'ok',
      data: { docId: 'doc_stub_001', users: this.getUsers() },
    }
  }

  private getUsers(): UserInfo[] {
    const seen = new Set<string>()
    const users: UserInfo[] = []
    for (const c of this.clients.values()) {
      if (seen.has(c.clientId)) continue
      seen.add(c.clientId)
      users.push({
        id: users.length + 1,
        docId: 'doc_stub_001',
        clientId: c.clientId,
        name: c.name,
        color: c.color,
        status: 'online',
        joinedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      })
    }
    return users
  }

  private emptySnapshot(): Snapshot {
    return {
      id: 'sheet_stub_001',
      name: 'Sheet1',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      rowCount: 100,
      colCount: 26,
      styles: {},
      cells: {},
    }
  }
}

// ============================================================
//  暴露到全局 — 浏览器 F12 控制台直接跑
// ============================================================

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).testCollab = () => {
    console.log('===== testCollab started =====')
    const s = new LocalStubServer()
    console.log('server created, creating clients...')
    const p = console.log

    const cb = (name: string): CollabCallbacks => ({
      onSnapshot: (_, seq) => p(`[${name}] snapshot loaded, seq=${seq}`),
      onCellUpdated: (d) => p(`[${name}] cell [${d.row},${d.col}]="${d.value}" seq=${d.seq}`),
      onSheetImported: () => p(`[${name}] sheet imported`),
      onUndoApplied: (d) => p(`[${name}] undo → [${d.row},${d.col}]="${d.value}"`),
      onRedoApplied: (d) => p(`[${name}] redo → [${d.row},${d.col}]="${d.value}"`),
      onPresence: (users) => p(`[${name}] online: ${users.map((u) => u.name).join(', ')}`),
      onError: (code, msg) => p(`[${name}] ERROR ${code}: ${msg}`),
      onConnectionChange: (s) => p(`[${name}] ${s}`),
    })

    const alice = s.createClient('u1', 'Alice', '#f00', cb('Alice'))
    const bob = s.createClient('u2', 'Bob', '#0f0', cb('Bob'))

    setTimeout(() => {
      p('\n--- Alice writes "hello" ---')
      alice.setCell(1, 1, 'hello')
    }, 300)
    setTimeout(() => {
      p('\n--- Bob overwrites "world" (LWW) ---')
      bob.setCell(1, 1, 'world')
    }, 600)
    setTimeout(() => {
      p('\n--- Alice undo ---')
      alice.undo()
    }, 900)
    setTimeout(() => {
      p('\n--- Alice redo ---')
      alice.redo()
    }, 1200)
    setTimeout(() => {
      p('\n===== DONE =====')
      alice.disconnect()
      bob.disconnect()
    }, 1500)
  }

  console.log('[LocalStubServer_test] module loaded, testCollab available at window.testCollab')
}
