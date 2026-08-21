/**
 * FileUploader — 大文件上传「总指挥」
 *
 * 对应《大文件上传.md》10 步：
 *   1 选文件        → 外面 ImportExcelModal 选，这里 upload(file) 接收
 *   2 算 hash       → calculateFileHash + hash.worker
 *   3 切分片        → createChunks
 *   4 秒传          → uploadCheck，fileExist=true 直接结束
 *   5 断点续传      → uploadCheck.uploadedChunks，跳过已传
 *   6 并发上传      → ChunkUploader + ConcurrencyPool
 *   7 失败重试      → ChunkUploader.uploadSingleChunk 里做
 *   8 暂停/恢复     → chunkUploader.pause() / resume()
 *   9 合并          → uploadMerge
 *  10 完整性校验    → 后端 merge 时做；前端只看 HTTP 是否成功
 */

import { uploadCancel, uploadCheck, uploadMerge } from '@/services/uploadAPI'
import type { UploadMergeParams } from '@/services/uploadAPI'
import { calculateFileHash } from './calculateFileHash'
import { createChunks, DEFAULT_CHUNK_SIZE } from './createChunks'
import { ChunkUploader } from './uploadChunk'
import type { ChunkMeta, ChunkUploadProgress } from './uploadTypes'

/** 创建 FileUploader 时可传的配置 */
export type FileUploaderOptions = {
  chunkSize?: number // 每片多大，默认 2MB
  maxRetries?: number // 单片失败重试几次，默认 3
  onProgress?: (progress: ChunkUploadProgress) => void // 进度回调给 UI
  /** merge 时创建文档用（大 Excel 导入） */
  mergeContext?: Pick<UploadMergeParams, 'createdBy' | 'title' | 'eventId'>
}

/** upload() 成功后的返回值 */
export type FileUploadSuccess =
  | { type: 'fast'; fileHash: string; url?: string; docId?: string }
  | {
      type: 'full'
      fileHash: string
      url?: string
      docId?: string
      jobId?: string
    }

export class FileUploader {
  // ---------- 配置 ----------
  chunkSize: number
  maxRetries: number
  onProgress: (progress: ChunkUploadProgress) => void
  mergeContext: Pick<UploadMergeParams, 'createdBy' | 'title' | 'eventId'>

  // ---------- 当前这次上传的状态 ----------
  file: File | null
  fileHash: string
  chunks: ChunkMeta[]
  /** 传分片的工具（步骤6~8 都在它里面） */
  chunkUploader: ChunkUploader | null

  /** 已成功上传的字节数（算总进度用，md 9.1） */
  doneBytes: number
  /** 正在传的分片：index → 已传字节 */
  inflightBytes: Map<number, number>

  constructor(options: FileUploaderOptions = {}) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
    this.maxRetries = options.maxRetries ?? 3
    this.onProgress = options.onProgress ?? (() => {})
    this.mergeContext = options.mergeContext ?? {}

    this.file = null
    this.fileHash = ''
    this.chunks = []
    this.chunkUploader = null
    this.doneBytes = 0
    this.inflightBytes = new Map()
  }

  /**
   * 【唯一入口】上传一个 File
   * ImportExcelModal / uploadLargeExcelFile 调这个就行
   */
  async upload(file: File): Promise<FileUploadSuccess> {
    if (file.size === 0) {
      throw new Error('文件为空')
    }

    this.reset()
    this.file = file

    // —— 步骤2：算文件指纹（MD5）——
    this.report('hashing', 0, '正在计算文件指纹…')
    this.fileHash = await calculateFileHash(file, this.chunkSize, (percent) => {
      this.report('hashing', percent, `计算指纹 ${percent}%`)
    })

    // —— 步骤3：切分片（不 read 整个文件）——
    this.chunks = createChunks(file, this.chunkSize)

    // —— 步骤4 + 步骤5：问服务器 ——
    this.report('checking', 0, '正在检查服务器…')
    const checkResult = await uploadCheck({
      fileHash: this.fileHash,
      fileName: file.name,
      fileSize: file.size,
    })

    // —— 步骤4：秒传 ——
    if (checkResult.fileExist) {
      this.report('done', 100, '秒传成功，无需重复上传')
      return {
        type: 'fast',
        fileHash: this.fileHash,
        url: checkResult.url,
        docId: checkResult.docId,
      }
    }

    // —— 步骤5：断点 — 服务器已有哪些片 ——
    const alreadyUploaded = checkResult.uploadedChunks ?? []
    this.doneBytes = this.calcBytesByIndexes(alreadyUploaded)

    // —— 步骤6~8：并发传剩余分片 ——
    this.report('uploading', this.calcTotalPercent(), '正在上传分片…')
    await this.uploadChunksWithPool(alreadyUploaded)

    // —— 步骤9：通知服务器合并 ——
    this.report('merging', 100, '正在合并文件…')
    const mergeResult = await uploadMerge({
      fileHash: this.fileHash,
      fileName: file.name,
      fileSize: file.size,
      chunkTotal: this.chunks.length,
      ...this.mergeContext,
    })

    // —— 步骤10：合并成功（详细校验在后端）——
    this.report('done', 100, '上传完成')
    return {
      type: 'full',
      fileHash: this.fileHash,
      url: mergeResult.url,
      docId: mergeResult.docId,
      jobId: mergeResult.jobId,
    }
  }

  /**
   * 【步骤6~8】用 ChunkUploader 传所有还没传的片
   */
  async uploadChunksWithPool(alreadyUploaded: number[]): Promise<void> {
    if (!this.file) {
      throw new Error('没有 file')
    }

    this.chunkUploader = new ChunkUploader()

    await this.chunkUploader.uploadAll(
      this.chunks,
      {
        fileHash: this.fileHash,
        chunkTotal: this.chunks.length,
        maxRetries: this.maxRetries,
        onChunkProgress: (chunkIndex, loaded) => {
          // md 9.1：把「正在传的这一片」算进总进度
          this.inflightBytes.set(chunkIndex, loaded)
          this.report('uploading', this.calcTotalPercent(), '上传中')
        },
      },
      alreadyUploaded
    )

    // 传完后：按已成功分片重算 doneBytes（避免断点续传重复累加）
    this.doneBytes = this.calcBytesByIndexes([...this.chunkUploader.uploadedChunks])
    this.inflightBytes.clear()

    this.report('uploading', this.calcTotalPercent(), '上传中')
  }

  /** 【步骤8】暂停 */
  pause() {
    this.chunkUploader?.pause()
  }

  /** 【步骤8】恢复 */
  resume() {
    this.chunkUploader?.resume()
  }

  /** 取消：停请求 + 通知后端删临时文件 */
  async cancel() {
    this.chunkUploader?.cancel()
    if (this.fileHash) {
      await uploadCancel(this.fileHash)
    }
  }

  // ==================== 下面是内部小工具 ====================

  /** 重置状态（每次 upload 开始前） */
  reset() {
    this.file = null
    this.fileHash = ''
    this.chunks = []
    this.chunkUploader = null
    this.doneBytes = 0
    this.inflightBytes.clear()
  }

  /** 根据分片 index 列表，算出已经有多少字节（断点续传用） */
  calcBytesByIndexes(indexes: number[]): number {
    let sum = 0
    for (const index of indexes) {
      const chunk = this.chunks[index]
      if (chunk) {
        sum = sum + chunk.size
      }
    }
    return sum
  }

  /**
   * md 9.1：总进度 = 已完成的字节 + 正在传的字节 / 文件总大小
   * 不是「传了几片 / 总片数」
   */
  calcTotalPercent(): number {
    if (!this.file || this.file.size === 0) {
      return 0
    }

    let loaded = this.doneBytes
    for (const bytes of this.inflightBytes.values()) {
      loaded = loaded + bytes
    }

    const percent = Math.round((loaded / this.file.size) * 100)
    if (percent > 100) return 100
    return percent
  }

  /** 统一通知 UI 更新进度条 */
  report(phase: ChunkUploadProgress['phase'], percent: number, message: string) {
    this.onProgress({
      phase,
      percent,
      message,
    })
  }
}
