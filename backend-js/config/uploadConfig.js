const path = require('path');

const uploadConfig = {
  /** 分片与合并文件的根目录（backend-js/uploads） */
  uploadRoot: path.resolve(__dirname, '../uploads'),
  /** 单片最大 20MB */
  maxChunkBytes: Number(process.env.UPLOAD_MAX_CHUNK_BYTES || 20 * 1024 * 1024),
  /** 整文件最大 200MB */
  maxFileBytes: Number(process.env.UPLOAD_MAX_FILE_BYTES || 200 * 1024 * 1024),
  /** 上传会话保留 24 小时 */
  sessionTtlMs: Number(process.env.UPLOAD_SESSION_TTL_MS || 24 * 60 * 60 * 1000),
};

module.exports = uploadConfig;
