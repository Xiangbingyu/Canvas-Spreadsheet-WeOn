type StatusBarProps = {
  onlineCount?: number
  userName?: string
}

export function StatusBar({ onlineCount = 3, userName = '演示用户' }: StatusBarProps) {
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#dadce0] bg-[#f8f9fa] px-3 text-[11px] text-[#5f6368]">
      <span>
        {onlineCount} 位用户正在编辑 · 当前：{userName}
      </span>
      <span className="text-[#80868b]">就绪</span>
    </div>
  )
}
