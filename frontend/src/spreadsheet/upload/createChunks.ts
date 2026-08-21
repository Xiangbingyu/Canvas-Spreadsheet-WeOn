/**
 * 【步骤3】把大 File 切成很多小 Blob
 *
 * 为什么不用 file.arrayBuffer()？
 * → 那会一次性把整个文件读进内存，GB 级会爆。
 * slice 只是「切一刀的引用」，几乎不占内存。
 */

import type { ChunkMeta } from './uploadTypes'
/** 默认每片 2MB（md 建议 2~5MB） */
export const DEFAULT_CHUNK_SIZE = 1 * 1024 * 1024

export function createChunks(file: File, chunkSize = DEFAULT_CHUNK_SIZE): ChunkMeta[] {
  const chunks: ChunkMeta[] = []
  let start = 0
  let index = 0
  while (start < file.size) {
    const end = Math.min(start + chunkSize, file.size)
    chunks.push({
      index,
      start,
      end,
      blob: file.slice(start, end),
      size: end - start,
    })
    start = end
    index += 1
  }
  return chunks
}
