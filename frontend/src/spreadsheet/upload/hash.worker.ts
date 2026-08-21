/**
 * 【步骤2】Web Worker：逐片读文件，增量算 MD5
 *
 * 为什么在 Worker？
 * → 算大文件 hash 很耗时，放主线程页面会卡死。
 */
import SparkMD5 from 'spark-md5'

type HashRequest = {
  type: 'hash'
  file: File
  chunkSize: number
}

type HashMsg =
  | { type: 'progress'; percent: number }
  | { type: 'done'; hash: string }
  | { type: 'error'; message: string }

self.onmessage = async (event: MessageEvent<HashRequest>) => {
  if (event.data.type !== 'hash') return
  const { file, chunkSize } = event.data
  try {
    const spark = new SparkMD5.ArrayBuffer()
    const total = Math.ceil(file.size / chunkSize)
    let current = 0
    while (current < total) {
      const start = current * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const buf = await file.slice(start, end).arrayBuffer()
      spark.append(buf)
      current += 1
      const percent = Math.round((current / total) * 100)
      self.postMessage({ type: 'progress', percent } satisfies HashMsg)
    }
    self.postMessage({ type: 'done', hash: spark.end() } satisfies HashMsg)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'hash failed'
    self.postMessage({ type: 'error', message } satisfies HashMsg)
  }
}
