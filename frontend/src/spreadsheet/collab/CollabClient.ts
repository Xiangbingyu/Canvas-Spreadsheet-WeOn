import type {
  WsResponse,
  CellUpdated,
  TitleUpdated,
  CursorUpdate,
  SheetImported,
  UndoApplied,
  RedoApplied,
  UserInfo,
  Snapshot,
} from '../model/collabProtocol'
import { OfflineQueue, type QueuedOp } from './offlineQueue'

// ===== 回调接口 =====

export interface CollabCallbacks {
  /** join_ack 返回全量快照 */
  onSnapshot: (snapshot: Snapshot, currentSeq: number) => void
  /** 单元格被更新（别人或自己的操作被服务端确认） */
  onCellUpdated: (data: CellUpdated['data']) => void
  /** 标题被更新 */
  onTitleUpdated: (data: TitleUpdated['data']) => void
  /** 其他用户光标位置变化 */
  onCursor: (data: CursorUpdate['data']) => void
  /** 整表导入 */
  onSheetImported: (data: SheetImported['data']) => void
  /** 撤销 */
  onUndoApplied: (data: UndoApplied['data']) => void
  /** 重做 */
  onRedoApplied: (data: RedoApplied['data']) => void
  /** 在线用户列表更新 */
  onPresence: (users: UserInfo[]) => void
  /** 错误 */
  onError: (code: number, message: string) => void
  /** 连接状态变化 */
  onConnectionChange: (status: 'connected' | 'disconnected' | 'reconnecting') => void
}

// ===== CollabClient =====

export interface CollabClientOptions {
  url: string
  docId: string
  clientId: string
  userName?: string
  userColor?: string
  callbacks: CollabCallbacks
  reconnectInterval?: number
  /** 拦截 send，消息不发 WebSocket 而是交给此回调（LocalStubServer 用） */
  onSend?: (msg: Record<string, unknown>) => void
}

export class CollabClient {
  private ws: WebSocket | null = null
  private url: string
  private docId: string
  private clientId: string
  private userName: string
  private userColor: string
  private callbacks: CollabCallbacks

  private seq = 0
  private seenSeqs = new Set<number>()
  private pendingOps = new Map<number, () => void>()
  private sendQueue: string[] = []

  private onSend?: (msg: Record<string, unknown>) => void
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectInterval: number
  private destroyed = false

  constructor(options: CollabClientOptions) {
    this.url = options.url
    this.docId = options.docId
    this.clientId = options.clientId
    this.userName = options.userName ?? ''
    this.userColor = options.userColor ?? '#3b82f6'
    this.callbacks = options.callbacks
    this.reconnectInterval = options.reconnectInterval ?? 1000
    this.onSend = options.onSend
  }

  // ============================
  //  生命周期
  // ============================

  connect(): void {
    if (this.destroyed) return
    if (this.onSend) return // stub 模式，不创建真实 WebSocket

    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.callbacks.onConnectionChange('connected')
      this.join()
      this.flushSendQueue()
    }

    this.ws.onmessage = (event) => {
      let msg: WsResponse
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        this.callbacks.onError(5000, 'Failed to parse server message')
        return
      }
      this.handleMessage(msg)
    }

    this.ws.onclose = () => {
      if (!this.destroyed) {
        this.callbacks.onConnectionChange('disconnected')
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      // onclose 紧随其后，重连逻辑在 onclose 处理
    }
  }

  disconnect(): void {
    this.destroyed = true
    this.clearReconnectTimer()
    this.pendingOps.clear()
    this.seenSeqs.clear()
    this.sendQueue = []
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onerror = null
      if (this.ws.readyState === WebSocket.CONNECTING) {
        // 握手未完成就 close 会报 "closed before established"
        // 等 open 后立即关，规避 StrictMode 双挂载噪声
        const ws = this.ws
        ws.onopen = () => ws.close()
      } else {
        this.ws.close()
      }
      this.ws = null
    }
  }

  // ============================
  //  发送
  // ============================

  private join(): void {
    this.send({
      type: 'join',
      docId: this.docId,
      clientId: this.clientId,
      name: this.userName,
      color: this.userColor,
    })
  }

  setCell(
    row: number,
    col: number,
    value: string,
    style: Record<string, unknown> | null,
    baseSeq: number
  ): void {
    this.send({
      type: 'set_cell',
      docId: this.docId,
      clientId: this.clientId,
      row,
      col,
      value,
      style,
      baseSeq,
    })
  }

  setTitle(title: string, baseSeq: number): void {
    this.send({
      type: 'set_title',
      docId: this.docId,
      clientId: this.clientId,
      title,
      baseSeq,
    })
  }

  importSheet(snapshot: Snapshot, eventId?: string): void {
    this.send({
      type: 'import_sheet',
      docId: this.docId,
      clientId: this.clientId,
      snapshot,
      eventId,
    })
  }

  sendCursor(row: number, col: number): void {
    this.send({ type: 'cursor', docId: this.docId, clientId: this.clientId, row, col })
  }

  undo(): void {
    this.send({ type: 'undo', docId: this.docId, clientId: this.clientId })
  }

  redo(): void {
    this.send({ type: 'redo', docId: this.docId, clientId: this.clientId })
  }

  // ============================
  //  消息入口（公开，方便 stub server 注入）
  // ============================

  /** 接收并分发一条服务端消息（LocalStubServer 通过此方法注入消息） */
  receiveMessage(msg: WsResponse): void {
    this.handleMessage(msg)
  }

  // ============================
  //  消息分发
  // ============================

  private handleMessage(msg: WsResponse): void {
    switch (msg.type) {
      case 'join_ack':
        this.seq = msg.data.currentSeq
        this.seenSeqs.clear()
        this.pendingOps.clear()
        this.callbacks.onSnapshot(msg.data.snapshot, msg.data.currentSeq)
        this.callbacks.onPresence(msg.data.users)
        this.replayOfflineQueue()
        break

      case 'cell_updated':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onCellUpdated(msg.data)
        })
        break

      case 'title_updated':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onTitleUpdated(msg.data)
        })
        break

      case 'cursor_update':
        this.callbacks.onCursor(msg.data)
        break

      case 'sheet_imported':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onSheetImported(msg.data)
        })
        break

      case 'undo_applied':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onUndoApplied(msg.data)
        })
        break

      case 'redo_applied':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onRedoApplied(msg.data)
        })
        break

      case 'presence':
        this.callbacks.onPresence(msg.data.users)
        break

      case 'error':
        this.callbacks.onError(msg.code, msg.message)
        break
    }
  }

  // ============================
  //  顺序控制 + 幂等去重
  // ============================

  /**
   * 保证操作按 seq 顺序 apply。
   * 发送方会收到 2 条相同 seq 的消息(reply + broadcast)，靠 seenSeqs 去重。
   * 乱序到达的暂存到 pendingOps，等前面补齐后顺序消费。
   */
  private applyOrdered(seq: number, apply: () => void): void {
    // 幂等去重
    if (this.seenSeqs.has(seq)) return
    this.seenSeqs.add(seq)

    // 定期清理旧 seq，防止 Set 无限增长
    if (this.seenSeqs.size > 2000) {
      const toRemove = [...this.seenSeqs].filter((s) => s < this.seq - 1000)
      for (const s of toRemove) this.seenSeqs.delete(s)
    }

    // 不是下一个期望的 seq → 暂存
    if (seq > this.seq + 1) {
      this.pendingOps.set(seq, apply)
      return
    }

    // 恰是下一个 → apply
    apply()
    this.seq = seq

    // 消费暂存区中紧接着的操作
    while (this.pendingOps.has(this.seq + 1)) {
      const next = this.pendingOps.get(this.seq + 1)!
      this.pendingOps.delete(this.seq + 1)
      next()
      this.seq++
    }
  }

  // ============================
  //  重连
  // ============================

  private scheduleReconnect(): void {
    if (this.destroyed) return
    this.callbacks.onConnectionChange('reconnecting')
    // 清理状态，重连后靠 join_ack 全量 snapshot 重建，不补发旧消息
    this.seenSeqs.clear()
    this.pendingOps.clear()
    this.sendQueue = []
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, this.reconnectInterval)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ============================
  //  工具
  // ============================

  private send(msg: Record<string, unknown>): void {
    if (this.onSend) {
      this.onSend(msg)
      return
    }
    const data = JSON.stringify(msg)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
      return
    }
    // 首次握手期 → 内存队列；曾经连上过且是 set_cell → localStorage 持久化
    if (this.seq > 0 && msg.type === 'set_cell') {
      const m = msg as Record<string, unknown>
      OfflineQueue.enqueue({
        docId: this.docId,
        row: m.row as number,
        col: m.col as number,
        value: (m.value as string) ?? '',
        style: (m.style as Record<string, unknown> | null) ?? null,
        baseSeq: (m.baseSeq as number) ?? this.seq,
      })
    } else {
      this.sendQueue.push(data)
    }
  }

  private flushSendQueue(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const queue = this.sendQueue
    this.sendQueue = []
    for (const data of queue) {
      this.ws.send(data)
    }
  }

  private replayOfflineQueue(): void {
    const ops = OfflineQueue.dequeueAll()
    if (ops.length === 0) return
    const remaining: QueuedOp[] = []
    for (const op of ops) {
      if (op.docId !== this.docId) {
        remaining.push(op)
        continue
      }
      this.send({
        type: 'set_cell',
        docId: this.docId,
        clientId: this.clientId,
        row: op.row,
        col: op.col,
        value: op.value,
        style: op.style,
        baseSeq: op.baseSeq,
      })
    }
    // 放回其他文档的操作，避免 dequeueAll 误删
    for (const op of remaining) {
      OfflineQueue.enqueue(op)
    }
  }

  get currentSeq(): number {
    return this.seq
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
