export type ExcelExportScope = 'current' | 'all'

export type ExportDocExcelParams = {
  docId: string
  scope: ExcelExportScope
  activeSheetId?: string
}

function buildExportUrl(docId: string, scope: ExcelExportScope, activeSheetId?: string): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? ''
  const params = new URLSearchParams({ scope })
  if (scope === 'current' && activeSheetId) {
    params.set('activeSheetId', activeSheetId)
  }
  return `${base}/docs/${encodeURIComponent(docId)}/export?${params.toString()}`
}

function parseFileNameFromDisposition(header: string | null): string | null {
  if (!header) return null

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const plainMatch = header.match(/filename="?([^";]+)"?/i)
  return plainMatch?.[1] ?? null
}

async function readExportError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { message?: string }
    if (body?.message) return new Error(body.message)
  } catch {
    // ignore non-json body
  }
  return new Error(`导出失败 HTTP ${res.status}`)
}

/** 请求后端导出 .xlsx 并触发浏览器下载 */
export async function downloadDocExcel(params: ExportDocExcelParams): Promise<string> {
  const res = await fetch(buildExportUrl(params.docId, params.scope, params.activeSheetId))
  if (!res.ok) {
    throw await readExportError(res)
  }

  const blob = await res.blob()
  const fileName =
    parseFileNameFromDisposition(res.headers.get('Content-Disposition')) ?? 'export.xlsx'

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)

  return fileName
}
