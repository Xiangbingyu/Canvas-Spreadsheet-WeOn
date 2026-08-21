import type { UploadCheckData, UploadMergeData } from './uploadType'

const UPLOAD_BASE = '/api/upload'

/** 后端统一格式 { code, message, data } → 取出 data */
async function readUploadData<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`${action}失败 HTTP ${res.status}`)
  }

  const body = (await res.json()) as {
    code?: number
    message?: string
    data?: T
  }

  if (typeof body.code === 'number' && body.code !== 0) {
    throw new Error(body.message || `${action}失败`)
  }

  if (body && typeof body.code === 'number' && 'data' in body) {
    return body.data as T
  }

  return body as T
}

export type UploadMergeParams = {
  fileHash: string
  fileName: string
  fileSize: number
  chunkTotal: number
  createdBy?: string
  title?: string
  eventId?: string
}

/** 上传前检查：会不会秒传？哪些分片已经传过了？ */
export async function uploadCheck(body: {
  fileHash: string
  fileName: string
  fileSize: number
}): Promise<UploadCheckData> {
  const res = await fetch(`${UPLOAD_BASE}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readUploadData<UploadCheckData>(res, '检查上传')
}

/** 所有分片都传完 → 告诉后端「可以合并了」 */
export async function uploadMerge(body: UploadMergeParams): Promise<UploadMergeData> {
  const res = await fetch(`${UPLOAD_BASE}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readUploadData<UploadMergeData>(res, '合并')
}

/** 用户点「取消」→ 让后端删掉临时分片 */
export async function uploadCancel(fileHash: string): Promise<void> {
  const res = await fetch(`${UPLOAD_BASE}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileHash }),
  })
  await readUploadData<{ cancelled: boolean }>(res, '取消上传')
}
