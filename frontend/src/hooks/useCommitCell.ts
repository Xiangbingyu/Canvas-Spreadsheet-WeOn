// 单元格提交回调的装配：协同开关 + WS 连接 + 本地兜底，集中在此 Hook，
// 让 SpreadsheetPage 只做组装（AGENTS §2.9）。

import { useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useCollab } from '@/hooks/useCollab'
import { updateCell } from '@/spreadsheet/store/workSheetStore'
import type { RootState } from '@/spreadsheet/store'
import type { CommitCellFn } from '@/hooks/useSpreadsheetInteraction'

// 协同总开关：false 时编辑直接走本地 dispatch(updateCell)，不连 WS。
// 用于在后端/协同未就绪时先验证编辑/样式/undo 功能本身。后端就绪后改回 true。
const USE_COLLAB = true

// 协同连接配置：WS 地址默认走 Vite 代理（/ws → 后端）
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

/**
 * 返回单元格提交函数：
 * - 协同开：走 WS（setCell）。Style 是领域类型，setCell 用线缆类型，此处桥接转换。
 * - 协同关：直接 dispatch(updateCell) 本地落库，便于脱离后端验证功能。
 *
 * docId / clientId 从 userStore（collab slice）读取——打开文档时由 StartPage/Menubar
 * dispatch(setDocSession) 写入，因此每个文档连接到自己的协同房间。
 */
export function useCommitCell(): CommitCellFn {
  const dispatch = useDispatch()
  const docId = useSelector((s: RootState) => s.collab.docId)
  const clientId = useSelector((s: RootState) => s.collab.clientId)

  const { connect, setCell } = useCollab({ url: WS_URL, docId, clientId })

  // 连接 WS：仅在协同开启且 docId 已就绪时连接。docId 变化（切换文档）时重连。
  useEffect(() => {
    if (USE_COLLAB && docId) connect()
  }, [connect, docId])

  return useMemo<CommitCellFn>(
    () =>
      USE_COLLAB
        ? (row, col, value, style) =>
            setCell(row, col, value, style as unknown as Record<string, unknown> | undefined)
        : (row, col, value, style) => dispatch(updateCell({ row, col, value, style })),
    [setCell, dispatch]
  )
}
