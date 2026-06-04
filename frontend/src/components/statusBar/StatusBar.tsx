import { useSelector } from 'react-redux'
import type { RootState } from '@/spreadsheet/store'
import { OnlineUsers } from '@/components/CollabStatus/OnlineUsers'

type StatusBarProps = {
  awaitingDisplayName?: boolean
}

export function StatusBar({ awaitingDisplayName }: StatusBarProps) {
  const users = useSelector((s: RootState) => s.collab.users)
  const userNames = users.map((u) => u.name).join('、')

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#dadce0] bg-[#f8f9fa] px-3 text-[11px] text-[#5f6368]">
      <span>
        {users.length} 位用户正在编辑{userNames ? ` · ${userNames}` : ''}
      </span>
      <OnlineUsers awaitingDisplayName={awaitingDisplayName} />
    </div>
  )
}
