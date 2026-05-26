type LoadingProps = {
  message?: string
  visible?: boolean
}

/** Excel 上传等场景的加载遮罩（静态占位） */
export function Loading({ message = '正在上传…', visible = false }: LoadingProps) {
  if (!visible) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#dadce0] border-t-[#1a73e8]" />
        <p className="text-[14px] text-[#5f6368]">{message}</p>
      </div>
    </div>
  )
}
