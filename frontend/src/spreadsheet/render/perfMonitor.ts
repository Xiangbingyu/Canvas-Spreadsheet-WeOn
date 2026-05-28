// Development-only canvas render performance monitor for baseline measurements.
// Input: render durations and manual sessions; output: console summaries for tables.
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

type CanvasPerfApi = {
  start: (caseName: string, operation: string) => void
  stop: () => CanvasPerfSummary | null
  reset: () => void
  recordRender: (durationMs: number) => void
  summary: () => CanvasPerfSummary | null
}

declare global {
  interface Window {
    __canvasPerf?: CanvasPerfApi
  }
}

const enabled = import.meta.env.DEV
let activeSession: CanvasPerfSession | null = null
let lastSummary: CanvasPerfSummary | null = null
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

if (enabled && typeof window !== 'undefined') {
  window.__canvasPerf = canvasPerf
  console.info(
    "[canvas-perf] ready. Use window.__canvasPerf.start('A 空表', '连续滚动 5s') and window.__canvasPerf.stop()."
  )
}
