/** 一片文件的信息 切完就长这样 */
export type ChunkMeta = {
  index: number // 第几片，从 0 开始，合并时必须按这个顺序
  start: number
  end: number
  blob: Blob // file.slice 出来的，不会一次性读进内存
  size: number
}
/** 给 ImportExcelModal 进度条用的结构 */
export type ChunkUploadProgress = {
  /** hashing=算指纹 checking=问服务器 uploading=传分片 merging=合并 done=结束 */
  phase: 'hashing' | 'checking' | 'uploading' | 'merging' | 'done'
  percent: number // 0~100
  message: string
}
/** uploadLargeExcel 成功后的结果 */
export type LargeExcelUploadResult =
  | { type: 'fast'; fileHash: string; url?: string; docId?: string }
  | { type: 'full'; fileHash: string; url?: string; docId?: string; jobId?: string }

export class ChunkUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChunkUploadError'
  }
}
