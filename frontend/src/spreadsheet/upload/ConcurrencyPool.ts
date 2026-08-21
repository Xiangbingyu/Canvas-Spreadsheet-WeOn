/**
 *
 * 怎么用：
 *   const pool = new ConcurrencyPool(3)
 *   pool.add(() => uploadChunkWithRetry(...))  // 往队列塞任务
 *   pool.start()                               // 开始，最多 3 个同时跑
 *   await pool.waitAllDone()                   // 等全部完成
 */

/** 每个 task 是一个「执行上传」的异步函数 */
type PoolTask = () => Promise<unknown>

export class ConcurrencyPool {
  limit: number // 最大并发数（同时跑几个）
  running: number // 当前正在跑几个
  queue: PoolTask[] // 还没开始的任务，排这里
  results: unknown[] // md 里的结果收集
  isPaused: boolean // true = 暂停，不再取新任务
  isAborted: boolean // true = 取消，整个上传作废

  /** 第一个失败的分片错误（上传场景用） */
  firstError: Error | null

  constructor(limit = 3) {
    this.limit = limit
    this.running = 0
    this.queue = []
    this.results = []
    this.isPaused = false
    this.isAborted = false
    this.firstError = null
  }

  /** 往队列里加一个任务（只是排队，不会马上执行） */
  add(task: PoolTask) {
    this.queue.push(task)
  }

  /**
   * 核心：从队列取 1 个任务执行
   * md 里叫 run()，完成一个在 finally 里再调 run()，把窗口填满
   */
  async run() {
    // 下面 4 个 if：任一成立就不取新任务
    if (this.isAborted) return
    if (this.isPaused) return
    if (this.running >= this.limit) return
    if (this.queue.length === 0) return

    this.running++
    const task = this.queue.shift()
    if (!task) {
      this.running--
      return
    }

    try {
      const result = await task()
      this.results.push(result)
    } catch (err) {
      // md：失败也 push 进 results
      this.results.push({ error: err })
      // 上传场景：记下第一个错误，后面 waitAllDone 会抛出去
      if (!this.firstError) {
        this.firstError = err instanceof Error ? err : new Error(String(err))
      }
      // 注意：这里不 throw，否则其它正在传的分片会被打断，不好排查
    } finally {
      this.running--
      // 没暂停、没取消 → 再取下一个，保持「最多 limit 个在跑」
      if (!this.isAborted && !this.isPaused) {
        void this.run()
      }
    }
  }

  /** 开始上传：先取消暂停，再一次性启动 limit 个 run */
  start() {
    this.isPaused = false
    for (let i = 0; i < this.limit; i++) {
      void this.run()
    }
  }

  /** 【步骤8】暂停：不再启动新任务（已在传的会继续传完） */
  pause() {
    this.isPaused = true
  }

  /** 【步骤8】恢复：继续传队列里剩下的 */
  resume() {
    if (this.isAborted) return
    this.isPaused = false
    for (let i = 0; i < this.limit; i++) {
      void this.run()
    }
  }

  /** 取消：清空队列，不再取新任务 */
  abort() {
    this.isAborted = true
    this.queue = []
  }

  /** 等所有任务跑完（FileUploader 里 await 这个） */
  waitAllDone(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (this.isAborted) {
          reject(new Error('上传已取消'))
          return
        }
        if (this.firstError) {
          reject(this.firstError)
          return
        }
        // running=0 且 queue 空 = 全传完了
        if (this.running === 0 && this.queue.length === 0) {
          resolve()
          return
        }
        setTimeout(tick, 50)
      }
      tick()
    })
  }
}
