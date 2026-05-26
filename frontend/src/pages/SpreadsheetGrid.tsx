const COL_COUNT = 18
const ROW_COUNT = 34

function columnLabel(index: number): string {
  let label = ''
  let n = index
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

const columns = Array.from({ length: COL_COUNT }, (_, i) => columnLabel(i))
const rows = Array.from({ length: ROW_COUNT }, (_, i) => i + 1)

type SpreadsheetGridProps = {
  activeCell?: string
}

export function SpreadsheetGrid({ activeCell = 'A1' }: SpreadsheetGridProps) {
  return (
    <div className="h-full overflow-auto bg-[#f8f9fa]">
      <table className="border-collapse text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 h-6 w-11 min-w-11 border border-[#dadce0] bg-[#f8f9fa] font-normal" />
            {columns.map((col) => (
              <th
                key={col}
                className="h-6 min-w-[100px] w-[100px] border border-[#dadce0] bg-[#f8f9fa] text-[11px] font-medium text-[#70757a]"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th className="sticky left-0 z-10 h-6 w-11 min-w-11 border border-[#dadce0] bg-[#f8f9fa] text-[11px] font-normal text-[#70757a]">
                {row}
              </th>
              {columns.map((col) => {
                const address = `${col}${row}`
                const isActive = address === activeCell
                return (
                  <td
                    key={address}
                    className={`relative h-6 min-w-[100px] w-[100px] border border-[#e0e0e0] bg-white p-0 ${
                      isActive ? 'outline outline-2 outline-[#1a73e8] -outline-offset-1 z-[1]' : ''
                    }`}
                  >
                    {isActive && (
                      <span
                        className="absolute -bottom-[3px] -right-[3px] z-10 h-1.5 w-1.5 bg-[#1a73e8]"
                        aria-hidden
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
