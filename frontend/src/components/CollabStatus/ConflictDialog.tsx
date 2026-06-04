import { useState } from 'react'
import type { ConflictInfo } from '@/spreadsheet/collab'

interface Props {
  conflicts: ConflictInfo[]
  onResolve: (decisions: Array<{ row: number; col: number; keepMine: boolean }>) => void
  onClose: () => void
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function cellLabel(row: number, col: number) {
  return `${String.fromCharCode(64 + col)}${row}`
}

export function ConflictDialog({ conflicts, onResolve, onClose }: Props) {
  const [choices, setChoices] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const c of conflicts) {
      init[`${c.row}:${c.col}`] = false // default: keep remote
    }
    return init
  })

  const handleConfirm = () => {
    onResolve(
      conflicts.map((c) => ({
        row: c.row,
        col: c.col,
        keepMine: choices[`${c.row}:${c.col}`] ?? false,
      }))
    )
    onClose()
  }

  if (conflicts.length === 0) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
      <div className="w-[480px] max-h-[70vh] overflow-auto rounded-lg bg-white p-6 shadow-xl">
        <h3 className="mb-1 text-base font-semibold text-gray-900">离线期间发生冲突</h3>
        <p className="mb-4 text-[13px] text-gray-500">
          你离线时修改了部分内容，其中 {conflicts.length} 个格子的编辑可能与别人的操作冲突：
        </p>

        <div className="space-y-4">
          {conflicts.map((c) => (
            <div
              key={`${c.row}:${c.col}`}
              className="rounded border border-orange-200 bg-orange-50 p-3"
            >
              <div className="mb-2 text-[13px] font-medium text-gray-700">
                格子 {cellLabel(c.row, c.col)}
              </div>
              <div className="text-[13px] text-gray-600">
                <div>
                  你的: &ldquo;{c.myValue}&rdquo; ({formatTime(c.myTimestamp)})
                </div>
                <div>
                  {c.remoteUserName || '在线协作方'}: &ldquo;{c.remoteValue || '未知'}&rdquo;
                </div>
              </div>

              {c.styleConflicts.length > 0 && (
                <div className="mt-2 border-t border-orange-200 pt-2">
                  <div className="text-[12px] text-gray-500 mb-1">样式冲突：</div>
                  {c.styleConflicts.map((sc) => (
                    <div key={sc.key} className="ml-2 text-[12px]">
                      <span className="text-gray-600">{sc.key}:</span>{' '}
                      <span className="text-blue-600">你的 {String(sc.myValue)}</span>
                      {' vs '}
                      <span className="text-red-600">
                        {c.remoteUserName || '在线协作方'} {String(sc.remoteValue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex gap-4">
                <label className="flex cursor-pointer items-center gap-1 text-[13px]">
                  <input
                    type="radio"
                    name={`conflict-${c.row}-${c.col}`}
                    checked={choices[`${c.row}:${c.col}`] === true}
                    onChange={() =>
                      setChoices((prev) => ({ ...prev, [`${c.row}:${c.col}`]: true }))
                    }
                  />
                  保留我的
                </label>
                <label className="flex cursor-pointer items-center gap-1 text-[13px]">
                  <input
                    type="radio"
                    name={`conflict-${c.row}-${c.col}`}
                    checked={choices[`${c.row}:${c.col}`] === false}
                    onChange={() =>
                      setChoices((prev) => ({ ...prev, [`${c.row}:${c.col}`]: false }))
                    }
                  />
                  保留对方的
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded bg-gray-100 px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-200"
            onClick={() => {
              // 全部保留对方的
              const allRemote: Record<string, boolean> = {}
              for (const c of conflicts) allRemote[`${c.row}:${c.col}`] = false
              setChoices(allRemote)
            }}
          >
            全部保留对方的
          </button>
          <button
            className="rounded bg-blue-500 px-3 py-1.5 text-[13px] text-white hover:bg-blue-600"
            onClick={() => {
              // 全部保留我的
              const allMine: Record<string, boolean> = {}
              for (const c of conflicts) allMine[`${c.row}:${c.col}`] = true
              setChoices(allMine)
            }}
          >
            全部保留我的
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700"
            onClick={handleConfirm}
          >
            确认选择
          </button>
        </div>
      </div>
    </div>
  )
}
