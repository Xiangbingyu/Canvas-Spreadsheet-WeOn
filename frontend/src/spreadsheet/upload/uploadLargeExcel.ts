import { FileUploader } from './FileUploader'
import type { UploadMergeParams } from '@/services/uploadAPI'
import type { ChunkUploadProgress, LargeExcelUploadResult } from './uploadTypes'
import { ChunkUploadError } from './uploadTypes'

export const LARGE_EXCEL_THRESHOLD_BYTES = 1 * 1024 * 1024

export function isLargeExcelFile(file: File): boolean {
  return file.size >= LARGE_EXCEL_THRESHOLD_BYTES
}

export async function uploadLargeExcelFile(
  file: File,
  options?: {
    onProgress?: (p: ChunkUploadProgress) => void
    uploaderRef?: { current: FileUploader | null }
    mergeContext?: Pick<UploadMergeParams, 'createdBy' | 'title' | 'eventId'>
  }
): Promise<LargeExcelUploadResult> {
  const uploader = new FileUploader({
    onProgress: options?.onProgress,
    mergeContext: options?.mergeContext,
  })
  if (options?.uploaderRef) {
    options.uploaderRef.current = uploader
  }

  try {
    return await uploader.upload(file)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ChunkUploadError(err instanceof Error ? err.message : '上传失败')
  }
}

export { FileUploader }
