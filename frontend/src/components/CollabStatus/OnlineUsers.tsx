import { useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import type { RootState } from '@/spreadsheet/store'

function statusColor(status: string): string {
  if (status === 'connected') return '#22c55e'
  if (status === 'reconnecting') return '#eab308'
  return '#ef4444'
}

function statusLabel(status: string): string {
  if (status === 'connected') return '已连接'
  if (status === 'reconnecting') return '重连中'
  return '已断开'
}

export function OnlineUsers() {
  const users = useSelector((s: RootState) => s.collab.users)
  const status = useSelector((s: RootState) => s.collab.connectionStatus)
  const wasConnected = useRef(false)

  // 断线/重连提示
  useEffect(() => {
    if (status === 'connected') {
      wasConnected.current = true
      return
    }
    // 从未连上过（初始 loading 态），不弹提示
    if (!wasConnected.current) return

    // 需要提示的重连态
    const t = status === 'reconnecting' ? '网络已断开，正在重连…' : '连接已断开'
    const banner = document.createElement('div')
    banner.className =
      'fixed top-0 left-0 right-0 z-50 bg-yellow-50 text-center text-[13px] leading-8 text-yellow-800 shadow'
    banner.textContent = t

    // 重连成功/断开恢复时自动清除同类型 banner
    document.querySelectorAll('.collab-status-banner').forEach((el) => el.remove())
    banner.classList.add('collab-status-banner')
    document.body.appendChild(banner)

    return () => {
      banner.remove()
    }
  }, [status])

  return (
    <div className="flex items-center gap-3">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: statusColor(status) }}
        title={statusLabel(status)}
      />
      {users.map((user) => (
        <span
          key={user.clientId}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white select-none"
          style={{ backgroundColor: user.color }}
          title={user.name}
        >
          {user.name ? user.name[0].toUpperCase() : '?'}
        </span>
      ))}
      {users.length === 0 && <span className="text-[11px] text-[#80868b]">仅自己</span>}
    </div>
  )
}
