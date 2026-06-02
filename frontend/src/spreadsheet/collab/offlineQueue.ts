const STORAGE_KEY = 'collab_offline_queue'
const MAX_QUEUE_SIZE = 500

export interface QueuedOp {
  type: 'set_cell'
  docId: string
  sheetId: string
  row: number
  col: number
  value: string
  style: Record<string, unknown> | null
  baseSeq: number
}

export interface QueuedBatchOp {
  type: 'batch_set_cell'
  docId: string
  sheetId: string
  baseSeq: number
  targets: Array<{ row: number; col: number }>
  value?: string
  style?: Record<string, unknown> | null
}

export type StoredOp = QueuedOp | QueuedBatchOp

function loadAll(): StoredOp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAll(ops: StoredOp[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ops))
  } catch {
    // localStorage 满或不可用，静默失败
  }
}

export const OfflineQueue = {
  enqueue(op: QueuedOp): void {
    const ops = loadAll()
    // 去重：同一 cell 的旧操作被新操作覆盖
    const idx = ops.findIndex((o) => o.type === 'set_cell' && o.row === op.row && o.col === op.col)
    if (idx >= 0) ops.splice(idx, 1)
    ops.push(op)
    while (ops.length > MAX_QUEUE_SIZE) ops.shift()
    saveAll(ops)
  },

  enqueueBatch(op: QueuedBatchOp): void {
    const ops = loadAll()
    ops.push(op)
    while (ops.length > MAX_QUEUE_SIZE) ops.shift()
    saveAll(ops)
  },

  dequeueAll(): StoredOp[] {
    const ops = loadAll()
    saveAll([])
    return ops
  },

  /** 仅移除指定的操作，保留其他的 */
  removeOps(toRemove: StoredOp[]): void {
    const ops = loadAll()
    const set = new Set(toRemove)
    saveAll(ops.filter((op) => !set.has(op)))
  },

  clear(): void {
    saveAll([])
  },

  size(): number {
    return loadAll().length
  },
}
