import { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import type { RootState } from '@/spreadsheet/store'

function relativeTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function LastEditTime() {
  const lastEditTime = useSelector((s: RootState) => s.collab.lastEditTime)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!lastEditTime) return
    const timer = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(timer)
  }, [lastEditTime])

  if (!lastEditTime) return null

  return (
    <span className="text-[11px] text-[#80868b] select-none">
      最近编辑: {relativeTime(lastEditTime)}
    </span>
  )
}
