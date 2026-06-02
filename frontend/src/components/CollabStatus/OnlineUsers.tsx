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

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium text-white select-none transition-opacity duration-300"
      style={{ backgroundColor: color }}
      title={name}
    >
      {name ? name[0].toUpperCase() : '?'}
    </span>
  )
}

export function OnlineUsers() {
  const clientId = useSelector((s: RootState) => s.collab.clientId)
  const users = useSelector((s: RootState) => s.collab.users)
  const status = useSelector((s: RootState) => s.collab.connectionStatus)
  const selfName = useSelector((s: RootState) => s.collab.selfName)
  const selfColor = useSelector((s: RootState) => s.collab.selfColor)
  // clientId 为空 = 尚未 join，不弹横幅避免初始闪烁
  const bannerVisible = clientId !== '' && status !== 'connected'
  const bannerText = status === 'reconnecting' ? '网络已断开，正在重连…' : '连接已断开'

  // 服务端 presence 列表包含自己，过滤掉避免重复
  const otherUsers = users.filter((u) => u.clientId !== clientId)

  return (
    <>
      {bannerVisible && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-50 text-center text-[13px] leading-8 text-yellow-800 shadow transition-opacity duration-300">
          {bannerText}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: statusColor(status) }}
          title={statusLabel(status)}
        />
        {selfName && <Avatar name={`${selfName} (我)`} color={selfColor || '#3b82f6'} />}
        {otherUsers.map((user) => (
          <Avatar key={user.clientId} name={user.name} color={user.color} />
        ))}
        {!selfName && otherUsers.length === 0 && (
          <span className="text-[11px] text-[#80868b]">仅自己</span>
        )}
      </div>
    </>
  )
}
