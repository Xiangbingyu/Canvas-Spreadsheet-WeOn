const STORAGE_KEY = 'collab_offline_queue'
const MAX_QUEUE_SIZE = 500

export interface QueuedOp {
  docId: string
  row: number
  col: number
  value: string
  style: Record<string, unknown> | null
  baseSeq: number
}

function loadAll(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAll(ops: QueuedOp[]): void {
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
    const idx = ops.findIndex((o) => o.row === op.row && o.col === op.col)
    if (idx >= 0) ops.splice(idx, 1)
    ops.push(op)
    // 上限保护
    while (ops.length > MAX_QUEUE_SIZE) ops.shift()
    saveAll(ops)
  },

  dequeueAll(): QueuedOp[] {
    const ops = loadAll()
    saveAll([])
    return ops
  },

  clear(): void {
    saveAll([])
  },

  size(): number {
    return loadAll().length
  },
}
