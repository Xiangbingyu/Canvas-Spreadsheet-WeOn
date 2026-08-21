/**
 * 【步骤6 + 步骤7 + 步骤8】分片上传
 *
 * md 对照：
 *   - 五-5.2  单分片失败重试（指数退避）
 *   - 六-6.1  pause：停池子 + abort 正在传的请求
 *   - 六-6.1  resume：跳过已传分片，只传剩下的
 *   - 九-9.1  XHR upload.onprogress 算进度（fetch 做不到）
 *
 * FileUploader 里用法：
 *   const uploader = new ChunkUploader()
 *   await uploader.uploadAll(chunks, { fileHash, chunkTotal, ... })
 */

import { ConcurrencyPool } from './ConcurrencyPool'
import type { ChunkMeta } from './uploadTypes'

/** 上传时需要的外部参数 */
export type ChunkUploadOptions = {
  fileHash: string
  chunkTotal: number
  maxRetries?: number // 默认 3 次
  /** 某一片传了多少字节（给总进度条用） */
  onChunkProgress?: (chunkIndex: number, loaded: number) => void
}

export class ChunkUploader {
  pool: ConcurrencyPool | null
  /** 每个正在传的分片对应一个 AbortController，pause 时用来 cancel 请求 */
  abortControllers: Map<number, AbortController>
  /** 已经传成功的分片编号，例如 Set {0, 1, 2} */
  uploadedChunks: Set<number>
  /** 本次要传的全部分片（resume 时要 filter） */
  allChunks: ChunkMeta[]
  /** 上传参数 */
  options: ChunkUploadOptions | null

  constructor() {
    this.pool = null
    this.abortControllers = new Map()
    this.uploadedChunks = new Set()
    this.allChunks = []
    this.options = null
  }

  /**
   * 【对外入口】上传全部分片
   * @param chunks createChunks 切出来的数组
   * @param options fileHash 等
   * @param alreadyUploaded 断点续传：服务器说已经有的分片 index（步骤5）
   */
  async uploadAll(
    chunks: ChunkMeta[],
    options: ChunkUploadOptions,
    alreadyUploaded: number[] = []
  ): Promise<void> {
    this.allChunks = chunks
    this.options = options

    // 步骤5：断点 — 这些片不用传了
    for (const index of alreadyUploaded) {
      this.uploadedChunks.add(index)
    }

    // 还要传的片
    const needUpload = this.allChunks.filter((chunk) => !this.uploadedChunks.has(chunk.index))

    if (needUpload.length === 0) {
      return // 全都传过了
    }

    // 步骤6：创建并发池，同时最多 3 片
    this.pool = new ConcurrencyPool(3)

    for (const chunk of needUpload) {
      this.pool.add(() => this.uploadSingleChunk(chunk))
    }

    this.pool.start()
    await this.pool.waitAllDone()
  }

  /**
   * 【步骤7】传一片：失败就重试，最多 maxRetries 次
   */
  async uploadSingleChunk(chunk: ChunkMeta): Promise<void> {
    if (!this.options) {
      throw new Error('缺少上传参数 options')
    }

    const maxRetries = this.options.maxRetries ?? 3
    let retries = 0

    while (retries <= maxRetries) {
      try {
        await this.sendOneChunkByXHR(chunk)
        // 成功 → 记下来，resume 时会跳过
        this.uploadedChunks.add(chunk.index)
        return
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        // 用户点了暂停/取消
        if (error.name === 'AbortError') {
          throw error
        }

        // md 5.1：4xx 不要重试
        if (error.message.includes('HTTP 4')) {
          throw error
        }

        retries++
        if (retries > maxRetries) {
          throw new Error(`分片 ${chunk.index} 失败，已重试 ${maxRetries} 次`, {
            cause: err,
          })
        }

        // 指数退避：等 1s、2s、4s…
        const waitMs = Math.pow(2, retries - 1) * 1000
        await sleep(waitMs)
      }
    }
  }

  /**
   * 【步骤6+9.1】真正发 HTTP：XHR + FormData
   * 每个分片一个 AbortController，pause 时可以 abort
   */
  sendOneChunkByXHR(chunk: ChunkMeta): Promise<void> {
    if (!this.options) {
      return Promise.reject(new Error('缺少上传参数'))
    }

    const { fileHash, chunkTotal, onChunkProgress } = this.options

    return new Promise((resolve, reject) => {
      const controller = new AbortController()
      this.abortControllers.set(chunk.index, controller)

      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/upload/chunk')
      xhr.timeout = 60_000

      // 进度条：这一片传了多少
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onChunkProgress) {
          onChunkProgress(chunk.index, event.loaded)
        }
      }

      xhr.onload = () => {
        this.abortControllers.delete(chunk.index)
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`HTTP ${xhr.status}`))
        }
      }

      xhr.onerror = () => {
        this.abortControllers.delete(chunk.index)
        reject(new Error('network error'))
      }

      xhr.ontimeout = () => {
        this.abortControllers.delete(chunk.index)
        reject(new Error('timeout'))
      }

      // pause 时 abort 会走到这里
      controller.signal.addEventListener(
        'abort',
        () => {
          xhr.abort()
          this.abortControllers.delete(chunk.index)
          reject(new DOMException('已暂停或取消', 'AbortError'))
        },
        { once: true }
      )

      const formData = new FormData()
      formData.append('fileHash', fileHash)
      formData.append('chunkIndex', String(chunk.index))
      formData.append('chunkTotal', String(chunkTotal))
      formData.append('file', chunk.blob, `part-${chunk.index}`)

      xhr.send(formData)
    })
  }

  /** 【步骤8】暂停 */
  pause() {
    if (this.pool) {
      this.pool.pause()
    }

    // 取消所有正在飞的请求
    this.abortControllers.forEach((controller) => {
      controller.abort()
    })
    this.abortControllers.clear()
  }

  /** 【步骤8】恢复：只传还没成功的片 */
  resume() {
    if (!this.pool || !this.options) {
      return
    }

    const remainingChunks = this.allChunks.filter((chunk) => !this.uploadedChunks.has(chunk.index))

    for (const chunk of remainingChunks) {
      this.pool.add(() => this.uploadSingleChunk(chunk))
    }

    this.pool.resume()
  }

  /** 取消整个上传 */
  cancel() {
    this.pause()
    if (this.pool) {
      this.pool.abort()
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
