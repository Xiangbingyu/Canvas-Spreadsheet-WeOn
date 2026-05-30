type LoadingProps = {
  message?: string
  visible?: boolean
  /** 0–100；传入时显示进度条，否则显示旋转动画 */
  percent?: number
  /** 嵌入父容器（无遮罩、无绝对定位），用于弹窗内进度展示 */
  inline?: boolean
}

/** 加载指示：默认带遮罩；inline 时仅渲染进度条/文案块 */
export function Loading({
  message = '正在处理…',
  visible = false,
  percent,
  inline = false,
}: LoadingProps) {
  if (!visible) return null

  const clampedPercent =
    percent !== undefined ? Math.min(100, Math.max(0, Math.round(percent))) : undefined
  const showProgress = clampedPercent !== undefined

  const content = (
    <div
      className={inline ? 'w-full' : 'flex w-[min(320px,88vw)] flex-col items-center gap-4 px-4'}
    >
      {showProgress ? (
        <div className="w-full">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#e8eaed]">
            <div
              className="h-full rounded-full bg-[#1a73e8] transition-[width] duration-200 ease-out"
              style={{ width: `${clampedPercent}%` }}
            />
          </div>
          <p className="mt-2 text-center text-[13px] tabular-nums text-[#5f6368]">
            {clampedPercent}%
          </p>
        </div>
      ) : (
        !inline && (
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#dadce0] border-t-[#1a73e8]" />
        )
      )}
      <p
        className={
          inline ? 'mt-2 text-[13px] text-[#5f6368]' : 'text-center text-[14px] text-[#5f6368]'
        }
      >
        {message}
      </p>
    </div>
  )

  if (inline) {
    return (
      <div className="mt-4" role="status" aria-live="polite" aria-busy="true">
        {content}
      </div>
    )
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-white/80"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {content}
    </div>
  )
}
