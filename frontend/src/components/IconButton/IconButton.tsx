import type { ButtonHTMLAttributes, ReactNode } from 'react'

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  children: ReactNode
  active?: boolean
}

export function IconButton({
  label,
  children,
  active = false,
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm hover:bg-[#e8eaed] active:bg-[#f0f4f9] disabled:opacity-40 ${active ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#3c4043]'} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
