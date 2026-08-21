/** POST /api/upload/check 的响应 */
export type UploadCheckData = {
  /** true = 服务器已有完整文件，不用传了（步骤4 秒传） */
  fileExist: boolean
  /** 秒传时可直接跳转的文档 ID */
  docId?: string
  /** 秒传时后端可直接给资源地址（可选） */
  url?: string
  /** 已经传成功的分片编号，例如 [0,1,2]（步骤5 断点续传） */
  uploadedChunks: number[]
}
/** POST /api/upload/merge 的响应 */
export type UploadMergeData = {
  /** 合并后的文件访问路径（可选，看后端怎么设计） */
  url?: string
  /** 后端若已创建文档，可直接给 docId（Excel 业务扩展） */
  docId?: string
  /** 或给解析任务 id，前端轮询（Excel 业务扩展） */
  jobId?: string
}
