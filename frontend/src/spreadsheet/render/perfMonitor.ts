// Canvas 渲染性能监控工具，用于开发阶段基线测量。
// 输入渲染耗时与更新链路时间点，输出控制台统计结果。

export type CanvasPerfSummary = {
  caseName: string
  operation: string
  renderCount: number
  avgRenderMs: number
  maxRenderMs: number
  longTask: string
  longTaskCount: number
  maxLongTaskMs: number
  totalLongTaskMs: number
  elapsedMs: number
}

export type SheetUpdateOperation = 'edit' | 'style' | 'delete' | 'unknown'

export type SheetUpdatePerfSummary = {
  id: number
  operation: SheetUpdateOperation
  cell: string
  historySnapshotMs: number | null
  commitMs: number | null
  historyPushMs: number | null
  storeToEffectMs: number | null
  effectToRenderStartMs: number | null
  renderMs: number | null
  endToEndMs: number | null
  layers: string
  status: 'active' | 'done'
}

type CanvasPerfSession = {
  caseName: string
  operation: string
  startedAt: number
  renderCount: number
  totalRenderMs: number
  maxRenderMs: number
  longTaskCount: number
  maxLongTaskMs: number
  totalLongTaskMs: number
}

type SheetUpdateTrace = {
  id: number
  operation: SheetUpdateOperation
  row: number
  col: number
  label?: string
  startedAt: number
  historySnapshotDoneAt?: number
  commitEndAt?: number
  historyPushDoneAt?: number
  worksheetObservedAt?: number
  renderStartAt?: number
  renderEndAt?: number
  renderDurationMs?: number
  layers?: string[]
}

type CanvasPerfApi = {
  start: (caseName: string, operation: string) => void
  stop: () => CanvasPerfSummary | null
  reset: () => void
  recordRender: (durationMs: number) => void
  summary: () => CanvasPerfSummary | null
}

type SheetUpdatePerfApi = {
  start: (
    operation: SheetUpdateOperation,
    row: number,
    col: number,
    label?: string
  ) => number | null
  markHistorySnapshotDone: (id: number | null) => void
  markCommitEnd: (id: number | null) => void
  markHistoryPushDone: (id: number | null) => void
  markWorksheetObserved: () => void
  markRenderStart: (layers: string[]) => void
  markRenderEnd: (durationMs: number, layers: string[]) => void
  summary: () => SheetUpdatePerfSummary | null
  reset: () => void
}

declare global {
  interface Window {
    __canvasPerf?: CanvasPerfApi
    __sheetUpdatePerf?: SheetUpdatePerfApi
  }
}

const enabled = import.meta.env.DEV
let activeSession: CanvasPerfSession | null = null
let lastSummary: CanvasPerfSummary | null = null
let activeUpdateTrace: SheetUpdateTrace | null = null
let lastUpdateSummary: SheetUpdatePerfSummary | null = null
let updateTraceSeq = 0
let longTaskObserver: PerformanceObserver | null = null

function ensureLongTaskObserver() {
  if (!enabled || longTaskObserver || typeof PerformanceObserver === 'undefined') {
    return
  }

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      if (!activeSession) {
        return
      }

      list.getEntries().forEach((entry) => {
        activeSession!.longTaskCount += 1
        activeSession!.totalLongTaskMs += entry.duration
        activeSession!.maxLongTaskMs = Math.max(activeSession!.maxLongTaskMs, entry.duration)
      })
    })
    longTaskObserver.observe({ entryTypes: ['longtask'] })
  } catch {
    longTaskObserver = null
  }
}

function toSummary(session: CanvasPerfSession, endedAt = performance.now()): CanvasPerfSummary {
  const avgRenderMs = session.renderCount > 0 ? session.totalRenderMs / session.renderCount : 0
  const longTask =
    session.longTaskCount > 0
      ? `${session.longTaskCount} 次，最长 ${session.maxLongTaskMs.toFixed(2)}ms`
      : '无'

  return {
    caseName: session.caseName,
    operation: session.operation,
    renderCount: session.renderCount,
    avgRenderMs: Number(avgRenderMs.toFixed(2)),
    maxRenderMs: Number(session.maxRenderMs.toFixed(2)),
    longTask,
    longTaskCount: session.longTaskCount,
    maxLongTaskMs: Number(session.maxLongTaskMs.toFixed(2)),
    totalLongTaskMs: Number(session.totalLongTaskMs.toFixed(2)),
    elapsedMs: Number((endedAt - session.startedAt).toFixed(2)),
  }
}

function roundOrNull(value: number | undefined): number | null {
  return value === undefined ? null : Number(value.toFixed(2))
}

function findActiveUpdateTrace(id: number | null): SheetUpdateTrace | null {
  if (!id || !activeUpdateTrace || activeUpdateTrace.id !== id) {
    return null
  }

  return activeUpdateTrace
}

function toSheetUpdateSummary(
  trace: SheetUpdateTrace,
  status: SheetUpdatePerfSummary['status']
): SheetUpdatePerfSummary {
  return {
    id: trace.id,
    operation: trace.operation,
    cell: `${trace.row}:${trace.col}`,
    historySnapshotMs: roundOrNull(
      trace.historySnapshotDoneAt ? trace.historySnapshotDoneAt - trace.startedAt : undefined
    ),
    commitMs: roundOrNull(
      trace.commitEndAt && trace.historySnapshotDoneAt
        ? trace.commitEndAt - trace.historySnapshotDoneAt
        : undefined
    ),
    historyPushMs: roundOrNull(
      trace.historyPushDoneAt && trace.commitEndAt
        ? trace.historyPushDoneAt - trace.commitEndAt
        : undefined
    ),
    storeToEffectMs: roundOrNull(
      trace.worksheetObservedAt && trace.commitEndAt
        ? trace.worksheetObservedAt - trace.commitEndAt
        : undefined
    ),
    effectToRenderStartMs: roundOrNull(
      trace.renderStartAt && trace.worksheetObservedAt
        ? trace.renderStartAt - trace.worksheetObservedAt
        : undefined
    ),
    renderMs: roundOrNull(trace.renderDurationMs),
    endToEndMs: roundOrNull(
      trace.renderEndAt ? trace.renderEndAt - trace.startedAt : performance.now() - trace.startedAt
    ),
    layers: trace.layers?.join(',') ?? '',
    status,
  }
}

function printSheetUpdateSummary(summary: SheetUpdatePerfSummary) {
  console.table([
    {
      id: summary.id,
      操作: summary.operation,
      单元格: summary.cell,
      '历史快照(ms)': summary.historySnapshotMs,
      '提交耗时(ms)': summary.commitMs,
      '历史入栈(ms)': summary.historyPushMs,
      'Store->组件(ms)': summary.storeToEffectMs,
      '组件->rAF(ms)': summary.effectToRenderStartMs,
      'Canvas render(ms)': summary.renderMs,
      '端到端(ms)': summary.endToEndMs,
      layers: summary.layers,
    },
  ])
}

export const canvasPerf: CanvasPerfApi = {
  start(caseName: string, operation: string) {
    if (!enabled) {
      return
    }

    ensureLongTaskObserver()
    activeSession = {
      caseName,
      operation,
      startedAt: performance.now(),
      renderCount: 0,
      totalRenderMs: 0,
      maxRenderMs: 0,
      longTaskCount: 0,
      maxLongTaskMs: 0,
      totalLongTaskMs: 0,
    }
    lastSummary = null
    console.info(`[canvas-perf] start: ${caseName} / ${operation}`)
  },

  stop() {
    if (!enabled || !activeSession) {
      return lastSummary
    }

    lastSummary = toSummary(activeSession)
    activeSession = null
    console.table([
      {
        Case: lastSummary.caseName,
        操作: lastSummary.operation,
        '平均 render(ms)': lastSummary.avgRenderMs,
        '最大 render(ms)': lastSummary.maxRenderMs,
        'render 次数': lastSummary.renderCount,
        'Long Task': lastSummary.longTask,
      },
    ])
    return lastSummary
  },

  reset() {
    activeSession = null
    lastSummary = null
    console.info('[canvas-perf] reset')
  },

  recordRender(durationMs: number) {
    if (!enabled || !activeSession) {
      return
    }

    activeSession.renderCount += 1
    activeSession.totalRenderMs += durationMs
    activeSession.maxRenderMs = Math.max(activeSession.maxRenderMs, durationMs)
  },

  summary() {
    if (!enabled) {
      return null
    }

    return activeSession ? toSummary(activeSession) : lastSummary
  },
}

export const sheetUpdatePerf: SheetUpdatePerfApi = {
  start(operation, row, col, label) {
    if (!enabled) {
      return null
    }

    updateTraceSeq += 1
    activeUpdateTrace = {
      id: updateTraceSeq,
      operation,
      row,
      col,
      label,
      startedAt: performance.now(),
    }
    lastUpdateSummary = null
    console.info(`[sheet-update-perf] start #${updateTraceSeq}: ${operation} ${row}:${col}`)
    return updateTraceSeq
  },

  markHistorySnapshotDone(id) {
    const trace = findActiveUpdateTrace(id)
    if (!enabled || !trace) {
      return
    }

    trace.historySnapshotDoneAt = performance.now()
  },

  markCommitEnd(id) {
    const trace = findActiveUpdateTrace(id)
    if (!enabled || !trace) {
      return
    }

    trace.commitEndAt = performance.now()
  },

  markHistoryPushDone(id) {
    const trace = findActiveUpdateTrace(id)
    if (!enabled || !trace) {
      return
    }

    trace.historyPushDoneAt = performance.now()
  },

  markWorksheetObserved() {
    if (!enabled || !activeUpdateTrace || activeUpdateTrace.worksheetObservedAt) {
      return
    }

    activeUpdateTrace.worksheetObservedAt = performance.now()
  },

  markRenderStart(layers) {
    if (
      !enabled ||
      !activeUpdateTrace ||
      !activeUpdateTrace.worksheetObservedAt ||
      activeUpdateTrace.renderStartAt
    ) {
      return
    }

    activeUpdateTrace.renderStartAt = performance.now()
    activeUpdateTrace.layers = layers
  },

  markRenderEnd(durationMs, layers) {
    if (
      !enabled ||
      !activeUpdateTrace ||
      !activeUpdateTrace.worksheetObservedAt ||
      !activeUpdateTrace.renderStartAt ||
      activeUpdateTrace.renderEndAt
    ) {
      return
    }

    activeUpdateTrace.renderEndAt = performance.now()
    activeUpdateTrace.renderDurationMs = durationMs
    activeUpdateTrace.layers = layers
    lastUpdateSummary = toSheetUpdateSummary(activeUpdateTrace, 'done')
    activeUpdateTrace = null
    printSheetUpdateSummary(lastUpdateSummary)
  },

  summary() {
    if (!enabled) {
      return null
    }

    if (activeUpdateTrace) {
      return toSheetUpdateSummary(activeUpdateTrace, 'active')
    }

    return lastUpdateSummary
  },

  reset() {
    activeUpdateTrace = null
    lastUpdateSummary = null
    console.info('[sheet-update-perf] reset')
  },
}

if (enabled && typeof window !== 'undefined') {
  window.__canvasPerf = canvasPerf
  window.__sheetUpdatePerf = sheetUpdatePerf
  console.info(
    "[canvas-perf] ready. Use window.__canvasPerf.start('A 空表', '连续滚动 5s') and window.__canvasPerf.stop()."
  )
  console.info(
    '[sheet-update-perf] ready. Edit a cell or apply a style, then run window.__sheetUpdatePerf.summary().'
  )
}
