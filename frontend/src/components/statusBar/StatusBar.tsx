import { useSelector } from 'react-redux'
import type { RootState } from '@/spreadsheet/store'

export function StatusBar() {
  const users = useSelector((s: RootState) => s.collab.users)
  const userIds = users.map((u) => u.clientId).join('、')

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#dadce0] bg-[#f8f9fa] px-3 text-[11px] text-[#5f6368]">
      <span>
        {users.length} 位用户正在编辑{userIds ? ` · ${userIds}` : ''}
      </span>
      <span className="text-[#80868b]">就绪</span>
    </div>
  )
}
