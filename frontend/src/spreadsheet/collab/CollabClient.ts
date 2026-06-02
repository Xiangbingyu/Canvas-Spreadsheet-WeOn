import type {
  WsResponse,
  CellUpdated,
  TitleUpdated,
  CursorUpdate,
  SheetImported,
  SheetAdded,
  UndoApplied,
  RedoApplied,
  RowInserted,
  RowDeleted,
  ColInserted,
  ColDeleted,
  UserInfo,
  Snapshot,
} from '../model/collabProtocol'
import { OfflineQueue, type StoredOp } from './offlineQueue'

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
  /** 行被插入 */
  onRowInserted?: (data: RowInserted['data']) => void
  /** 行被删除 */
  onRowDeleted?: (data: RowDeleted['data']) => void
  /** 列被插入 */
  onColInserted?: (data: ColInserted['data']) => void
  /** 列被删除 */
  onColDeleted?: (data: ColDeleted['data']) => void
  /** 新建工作表 */
  onSheetAdded?: (data: SheetAdded['data']) => void
  /** 在线用户列表更新 */
  onPresence: (users: UserInfo[]) => void
  /** 错误 */
  onError: (code: number, message: string) => void
  /** 连接状态变化 */
  onConnectionChange: (status: 'connected' | 'disconnected' | 'reconnecting') => void
  /** P2-3: 离线重连后检测到冲突 */
  onConflict?: (conflicts: ConflictInfo[]) => void
}

/** P2-3: 单个冲突信息 */
export interface ConflictInfo {
  row: number
  col: number
  myValue: string
  myTimestamp: number
  remoteValue: string
  styleConflicts: Array<{ key: string; myValue: unknown; remoteValue: unknown }>
  mergedStyle: Record<string, unknown> | null
}

interface ReplayTracker {
  row: number
  col: number
  myValue: string
  myTimestamp: number
  eventId: string
  /** 记录该 op 被分配的第一个 seq，用于检测间隙 */
  resolvedSeq?: number
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

  // P2-2: pending 确认 + 重连增强
  private pendingMessages = new Map<string, Record<string, unknown>>()
  // P2-3: 冲突追踪
  private replayTrackers: ReplayTracker[] = []
  private replayConflictTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private readonly maxRetries = 10
  private readonly baseReconnectInterval: number
  private connectAttemptId = 0
  private reconnectDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private pageHidden = false

  private onSend?: (msg: Record<string, unknown>) => void
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(options: CollabClientOptions) {
    this.url = options.url
    this.docId = options.docId
    this.clientId = options.clientId
    this.userName = options.userName ?? ''
    this.userColor = options.userColor ?? '#3b82f6'
    this.callbacks = options.callbacks
    this.baseReconnectInterval = options.reconnectInterval ?? 1000
    this.onSend = options.onSend

    // P2-2: 监听页面可见性，后台暂停重连
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.pageHidden = document.hidden
        if (document.hidden) {
          this.clearReconnectTimer()
        } else if (!this.isConnected && !this.destroyed) {
          this.clearReconnectTimer()
          this.connect()
        }
      })
    }
  }

  // ============================
  //  生命周期
  // ============================

  connect(): void {
    if (this.destroyed) return
    if (this.onSend) return // stub 模式，不创建真实 WebSocket

    const attemptId = ++this.connectAttemptId
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      // 竞态防护：不是最新握手就关闭
      if (attemptId !== this.connectAttemptId) {
        this.ws?.close()
        return
      }
      this.retryCount = 0
      this.callbacks.onConnectionChange('connected')
      this.join()
      this.flushSendQueue()
      // 网络抖动防抖：成功连接后取消待执行的重连
      if (this.reconnectDebounceTimer) {
        clearTimeout(this.reconnectDebounceTimer)
        this.reconnectDebounceTimer = null
      }
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
        // P2-2: 未确认的消息写入离线队列，防止丢失
        this.flushPendingToOfflineQueue()
        // 网络抖动防抖：500ms 后再决定是否重连
        this.clearReconnectDebounce()
        this.reconnectDebounceTimer = setTimeout(() => {
          this.scheduleReconnect()
        }, 500)
      }
    }

    this.ws.onerror = () => {
      // onclose 紧随其后，重连逻辑在 onclose 处理
    }
  }

  disconnect(): void {
    this.destroyed = true
    this.clearReconnectTimer()
    this.clearReconnectDebounce()
    this.pendingOps.clear()
    this.pendingMessages.clear()
    this.replayTrackers = []
    if (this.replayConflictTimer) {
      clearTimeout(this.replayConflictTimer)
      this.replayConflictTimer = null
    }
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
    sheetId: string,
    baseSeq: number
  ): void {
    const eventId = crypto.randomUUID()
    const msg: Record<string, unknown> = {
      type: 'set_cell',
      docId: this.docId,
      clientId: this.clientId,
      sheetId,
      row,
      col,
      value,
      style: style ?? null,
      baseSeq,
      eventId,
    }
    this.pendingMessages.set(eventId, msg)
    this.send(msg)
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

  sendCursor(sheetId: string, row: number, col: number): void {
    this.send({ type: 'cursor', docId: this.docId, clientId: this.clientId, sheetId, row, col })
  }

  undo(): void {
    this.send({ type: 'undo', docId: this.docId, clientId: this.clientId })
  }

  redo(): void {
    this.send({ type: 'redo', docId: this.docId, clientId: this.clientId })
  }

  insertRow(sheetId: string, row: number): void {
    this.send({
      type: 'insert_row',
      docId: this.docId,
      clientId: this.clientId,
      sheetId,
      row,
    })
  }

  deleteRow(sheetId: string, row: number): void {
    this.send({
      type: 'delete_row',
      docId: this.docId,
      clientId: this.clientId,
      sheetId,
      row,
    })
  }

  insertCol(sheetId: string, col: number): void {
    this.send({
      type: 'insert_col',
      docId: this.docId,
      clientId: this.clientId,
      sheetId,
      col,
    })
  }

  deleteCol(sheetId: string, col: number): void {
    this.send({
      type: 'delete_col',
      docId: this.docId,
      clientId: this.clientId,
      sheetId,
      col,
    })
  }

  addSheet(sheetName?: string): void {
    this.send({
      type: 'add_sheet',
      docId: this.docId,
      clientId: this.clientId,
      sheetName,
    })
  }

  /**
   * 批量改单元格：一批坐标 + 一个统一 patch（见接口文档2 batch_set_cell）。
   * updates 只带坐标；value/style 在顶层，整批共享。
   * 只传 style 表示只改样式、保留各格原值；只传 value 表示只改值。
   */
  setBatchCells(
    sheetId: string,
    baseSeq: number,
    targets: Array<{ row: number; col: number }>,
    patch: { value?: string; style?: Record<string, unknown> | null }
  ): void {
    const eventId = crypto.randomUUID()
    const msg: Record<string, unknown> = {
      type: 'batch_set_cell',
      docId: this.docId,
      clientId: this.clientId,
      sheetId,
      baseSeq,
      updates: targets.map((t) => ({ row: t.row, col: t.col })),
      eventId,
      ...(patch.value !== undefined ? { value: patch.value } : {}),
      ...(patch.style !== undefined ? { style: patch.style } : {}),
    }
    this.pendingMessages.set(eventId, msg)
    this.send(msg)
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
        this.pendingMessages.clear() // P2-2: snapshot 已是最新，旧 pending 作废
        this.callbacks.onSnapshot(msg.data.snapshot, msg.data.currentSeq)
        this.callbacks.onPresence(msg.data.users)
        this.replayOfflineQueue()
        break

      case 'cell_updated':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onCellUpdated(msg.data)
          const raw = msg.data as Record<string, unknown>
          // P2-2: 服务端回显 eventId 时清除 pending
          if (typeof raw.eventId === 'string') this.pendingMessages.delete(raw.eventId)
          // P2-3: 追踪离线回放的回执
          this.trackReplayAck(msg.data)
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

      case 'row_inserted':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onRowInserted?.(msg.data)
        })
        break

      case 'row_deleted':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onRowDeleted?.(msg.data)
        })
        break

      case 'col_inserted':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onColInserted?.(msg.data)
        })
        break

      case 'col_deleted':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onColDeleted?.(msg.data)
        })
        break

      case 'sheet_added':
        this.applyOrdered(msg.data.seq, () => {
          this.callbacks.onSheetAdded?.(msg.data)
        })
        break

      case 'batch_cell_updated':
        this.applyOrdered(msg.data.seq, () => {
          for (const update of msg.data.updates) {
            this.callbacks.onCellUpdated({
              docId: msg.data.docId,
              clientId: msg.data.clientId,
              sheetId: msg.data.sheetId,
              seq: msg.data.seq,
              row: update.row,
              col: update.col,
              value: update.value,
              style: update.style,
              canUndo: msg.data.canUndo,
              canRedo: msg.data.canRedo,
            })
          }
          // P2-2: 服务端回显 eventId 时清除 pending
          const raw = msg.data as Record<string, unknown>
          if (typeof raw.eventId === 'string') this.pendingMessages.delete(raw.eventId)
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
    if (this.destroyed || this.pageHidden) return
    if (this.retryCount >= this.maxRetries) {
      this.callbacks.onConnectionChange('failed')
      return
    }
    this.callbacks.onConnectionChange('reconnecting')
    this.seenSeqs.clear()
    this.pendingOps.clear()
    this.sendQueue = []
    // 指数退避: 1s → 2s → 4s → 8s → 16s → 30s(cap)
    const delay = Math.min(this.baseReconnectInterval * Math.pow(2, this.retryCount), 30_000)
    this.retryCount++
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearReconnectDebounce(): void {
    if (this.reconnectDebounceTimer) {
      clearTimeout(this.reconnectDebounceTimer)
      this.reconnectDebounceTimer = null
    }
  }

  /** P2-2: onclose 时将未确认消息写入 OfflineQueue，避免丢失 */
  private flushPendingToOfflineQueue(): void {
    if (this.pendingMessages.size === 0) return
    for (const msg of this.pendingMessages.values()) {
      if (msg.type === 'set_cell') {
        OfflineQueue.enqueue({
          type: 'set_cell',
          docId: this.docId,
          sheetId: (msg.sheetId as string) ?? '',
          row: msg.row as number,
          col: msg.col as number,
          value: (msg.value as string) ?? '',
          style: (msg.style as Record<string, unknown> | null) ?? null,
          baseSeq: (msg.baseSeq as number) ?? this.seq,
          timestamp: Date.now(),
        })
      } else if (msg.type === 'batch_set_cell') {
        const targets = (msg.updates as Array<{ row: number; col: number }> | undefined) ?? []
        OfflineQueue.enqueueBatch({
          type: 'batch_set_cell',
          docId: this.docId,
          sheetId: (msg.sheetId as string) ?? '',
          baseSeq: (msg.baseSeq as number) ?? this.seq,
          targets,
          value: 'value' in msg ? (msg.value as string) : undefined,
          style: 'style' in msg ? (msg.style as Record<string, unknown> | null) : undefined,
        })
      }
    }
    this.pendingMessages.clear()
  }

  // ============================
  //  工具
  // ============================

  private send(msg: Record<string, unknown>): void {
    if (this.onSend) {
      this.onSend(msg)
      return
    }
    // 使用自定义 replacer 保留 null 值
    const data = JSON.stringify(msg, (_key, value) => {
      return value === undefined ? null : value
    })
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
      return
    }
    // 首次握手期 → 内存队列；曾经连上过 → localStorage 持久化
    if (this.seq > 0) {
      if (msg.type === 'set_cell') {
        const m = msg as Record<string, unknown>
        OfflineQueue.enqueue({
          type: 'set_cell',
          docId: this.docId,
          sheetId: (m.sheetId as string) ?? '',
          row: m.row as number,
          col: m.col as number,
          value: (m.value as string) ?? '',
          style: (m.style as Record<string, unknown> | null) ?? null,
          baseSeq: (m.baseSeq as number) ?? this.seq,
          timestamp: Date.now(),
        })
        return
      }
      if (msg.type === 'batch_set_cell') {
        const m = msg as Record<string, unknown>
        const targets = (m.updates as Array<{ row: number; col: number }> | undefined) ?? []
        OfflineQueue.enqueueBatch({
          type: 'batch_set_cell',
          docId: this.docId,
          sheetId: (m.sheetId as string) ?? '',
          baseSeq: (m.baseSeq as number) ?? this.seq,
          targets,
          value: 'value' in m ? (m.value as string) : undefined,
          style: 'style' in m ? (m.style as Record<string, unknown> | null) : undefined,
        })
        return
      }
    }
    this.sendQueue.push(data)
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

    // P2-3: 清理旧的追踪和定时器
    this.replayTrackers = []
    if (this.replayConflictTimer) {
      clearTimeout(this.replayConflictTimer)
      this.replayConflictTimer = null
    }

    const remaining: StoredOp[] = []
    for (const op of ops) {
      if (op.docId !== this.docId) {
        remaining.push(op)
        continue
      }
      if (op.type === 'set_cell') {
        const eventId = crypto.randomUUID()
        this.replayTrackers.push({
          row: op.row,
          col: op.col,
          myValue: op.value,
          myTimestamp: op.timestamp || Date.now(),
          eventId,
        })
        this.send({
          type: 'set_cell',
          docId: this.docId,
          clientId: this.clientId,
          sheetId: op.sheetId,
          row: op.row,
          col: op.col,
          value: op.value,
          style: op.style,
          baseSeq: op.baseSeq,
          eventId,
        })
      } else if (op.type === 'batch_set_cell') {
        this.send({
          type: 'batch_set_cell',
          docId: this.docId,
          clientId: this.clientId,
          sheetId: op.sheetId,
          baseSeq: op.baseSeq,
          updates: op.targets.map((t) => ({ row: t.row, col: t.col })),
          ...(op.value !== undefined ? { value: op.value } : {}),
          ...(op.style !== undefined ? { style: op.style } : {}),
        })
      }
    }

    // P2-3: 5 秒后仍未收齐回执 → 按已收到的判断冲突
    if (this.replayTrackers.length > 0) {
      this.replayConflictTimer = setTimeout(() => {
        this.resolveConflicts()
      }, 5000)
    }

    // 放回其他文档的操作，避免 dequeueAll 误删
    for (const op of remaining) {
      if (op.type === 'set_cell') {
        OfflineQueue.enqueue(op)
      } else {
        OfflineQueue.enqueueBatch(op)
      }
    }
  }

  /** P2-3: cell_updated 回执时记录 replayed op 的 seq */
  private trackReplayAck(data: CellUpdated['data']): void {
    const raw = data as Record<string, unknown>
    const eventId = raw.eventId as string | undefined
    if (!eventId) return
    const tracker = this.replayTrackers.find((t) => t.eventId === eventId)
    if (!tracker) return
    tracker.resolvedSeq = data.seq
    // 全部收齐 → 立即判断
    if (this.replayTrackers.every((t) => t.resolvedSeq !== undefined)) {
      if (this.replayConflictTimer) {
        clearTimeout(this.replayConflictTimer)
        this.replayConflictTimer = null
      }
      this.resolveConflicts()
    }
  }

  /** P2-3: 收集冲突并回调 */
  private resolveConflicts(): void {
    if (this.replayTrackers.length === 0) return
    const conflicts: ConflictInfo[] = []
    // 按 seq 排序，检测间隙
    const sorted = [...this.replayTrackers]
      .filter((t) => t.resolvedSeq !== undefined)
      .sort((a, b) => (a.resolvedSeq ?? 0) - (b.resolvedSeq ?? 0))

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      // seq 间距 > 1 → 中间有操作插入 → 当前格可能冲突
      if ((curr.resolvedSeq ?? 0) - (prev.resolvedSeq ?? 0) > 1) {
        conflicts.push({
          row: curr.row,
          col: curr.col,
          myValue: curr.myValue,
          myTimestamp: curr.myTimestamp,
          remoteValue: '', // 服务端未回传别人的值，弹窗显示"未知"
          styleConflicts: [],
          mergedStyle: null,
        })
      }
    }

    this.replayTrackers = []
    if (conflicts.length > 0) {
      this.callbacks.onConflict?.(conflicts)
    }
  }

  get currentSeq(): number {
    return this.seq
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
