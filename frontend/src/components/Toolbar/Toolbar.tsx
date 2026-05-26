import type { ReactNode } from 'react'
import { IconButton } from '@/components/IconButton/IconButton'

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-[#dadce0]" aria-hidden />
}

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24]

const formatBtnClass =
  'inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-sm text-[#3c4043] hover:bg-[#e8eaed] active:bg-[#f0f4f9]'

function FormatButton({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`${formatBtnClass} ${className}`}
    >
      {children}
    </button>
  )
}

function FontSizeSelect() {
  return (
    <select
      className="h-7 w-12 cursor-default rounded border-0 bg-transparent px-1 text-center text-[13px] text-[#202124] hover:bg-[#e8eaed]"
      defaultValue="10"
      aria-label="字号"
    >
      {FONT_SIZES.map((size) => (
        <option key={size} value={size}>
          {size}
        </option>
      ))}
    </select>
  )
}

/** 斜体：衬线体 I，与 Google Sheets 一致 */
function ItalicMark() {
  return (
    <span
      className="block translate-y-px text-[19px] leading-none text-[#3c4043]"
      style={{
        fontFamily: 'Georgia, "Times New Roman", Times, serif',
        fontStyle: 'italic',
        fontWeight: 400,
      }}
    >
      I
    </span>
  )
}

/** 背景色：油漆桶 + 底部色条（仿 Google Sheets） */
function FillColorMark({ barColor = '#ffffff' }: { barColor?: string }) {
  return (
    <span className="flex flex-col items-center justify-center gap-[2px] px-0.5">
      <svg width="20" height="14" viewBox="0 0 24 20" fill="#3c4043" aria-hidden>
        <path d="M16.56 5.44 14.12 3 7 10.12 3 14.12l2.83 2.83 6.73-6.73Zm-2.12 9.06-1.06 1.06-5.66-5.66 1.06-1.06 5.66 5.66ZM18.65 5.88l-1.41-1.41a1 1 0 0 0-1.41 0l-.35.35 1.41 1.41.76-.35ZM9.5 14.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
      </svg>
      <span
        className="block h-[3px] w-[18px] rounded-[1px] border border-[#dadce0]"
        style={{ backgroundColor: barColor }}
      />
    </span>
  )
}

/** 字体颜色：A + 底部色条 */
function TextColorMark({ barColor = '#202124' }: { barColor?: string }) {
  return (
    <span className="flex flex-col items-center justify-center gap-0.5 px-0.5">
      <span className="text-[17px] font-semibold leading-none text-[#3c4043]">A</span>
      <span
        className="block h-[3px] w-[18px] rounded-[1px]"
        style={{ backgroundColor: barColor }}
      />
    </span>
  )
}

export function Toolbar() {
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-[#dadce0] bg-[#edf2fa] px-2 text-[13px]">
      <IconButton label="撤销">
        <UndoIcon />
      </IconButton>
      <IconButton label="重做">
        <RedoIcon />
      </IconButton>
      <Divider />

      <IconButton label="减小字号">−</IconButton>
      <FontSizeSelect />
      <IconButton label="增大字号">+</IconButton>
      <Divider />

      <FormatButton label="粗体">
        <strong className="text-[16px] font-bold leading-none text-[#3c4043]">B</strong>
      </FormatButton>
      <FormatButton label="斜体">
        <ItalicMark />
      </FormatButton>
      <FormatButton label="下划线">
        <span className="text-[16px] leading-none text-[#3c4043] underline decoration-[#3c4043] decoration-2 underline-offset-[3px]">
          U
        </span>
      </FormatButton>
      <Divider />

      <FormatButton label="字体颜色" className="w-8">
        <TextColorMark />
      </FormatButton>
      <FormatButton label="背景色" className="w-8">
        <FillColorMark />
      </FormatButton>
      <Divider />

      <IconButton label="左对齐">
        <AlignLeftIcon />
      </IconButton>
      <IconButton label="居中对齐">
        <AlignCenterIcon />
      </IconButton>
      <IconButton label="右对齐">
        <AlignRightIcon />
      </IconButton>
    </div>
  )
}

function UndoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.5 8c-2.65 0-5.05 1.16-6.7 3.02L3 8v9h9l-2.62-2.62c1.08-1.06 2.55-1.62 4.12-1.62 3.31 0 6 2.69 6 6s-2.69 6-6 6H8v2h4.5c4.14 0 7.5-3.36 7.5-7.5S16.64 8 12.5 8z" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8 7.36 8 4 11.36 4 15.5S7.36 23 11.5 23H16v-2h-4.5c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.57 0 3.04.56 4.12 1.62L15 15.5H24V6.5l-5.6 4.1z" />
    </svg>
  )
}

function AlignLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 3h18v2H3V3zm0 4h12v2H3V7zm0 4h18v2H3v-2zm0 4h12v2H3v-2zm0 4h18v2H3v-2z" />
    </svg>
  )
}

function AlignCenterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 3h18v2H3V3zm3 4h12v2H6V7zm-3 4h18v2H3v-2zm3 4h12v2H6v-2zm-3 4h18v2H3v-2z" />
    </svg>
  )
}

function AlignRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 3h18v2H3V3zm6 4h12v2H9V7zm-6 4h18v2H3v-2zm6 4h12v2H9v-2zm-6 4h18v2H3v-2z" />
    </svg>
  )
}
