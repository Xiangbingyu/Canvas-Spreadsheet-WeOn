/**
 * 【步骤2】主线程调用：启动 hash.worker，拿到 fileHash（32位MD5字符串）
 */

export function calculateFileHash(
  file: File,
  chunkSize: number,
  onProgress?: (percent: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), {
      type: 'module',
    })

    const cleanup = () => worker.terminate()

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data
      if (msg.type === 'progress') {
        onProgress?.(msg.percent)
        return
      }
      if (msg.type === 'done') {
        cleanup()
        resolve(msg.hash)
        return
      }
      if (msg.type === 'error') {
        cleanup()
        reject(new Error(msg.message))
      }
    }

    worker.onerror = () => {
      cleanup()
      reject(new Error('hash Worker 异常'))
    }

    worker.postMessage({ type: 'hash', file, chunkSize })
  })
}
