const fs = require('fs/promises');
const path = require('path');

const uploadConfig = require('../config/uploadConfig');
const { ERROR_CODES } = require('../protocol/errorCodes');
const excelUploadService = require('./excelUploadService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isValidFileHash(fileHash) {
  return typeof fileHash === 'string' && /^[a-f0-9]{32}$/i.test(fileHash);
}

function metaPath(fileHash) {
  return path.join(uploadConfig.uploadRoot, 'meta', `${fileHash}.json`);
}

function chunkDir(fileHash) {
  return path.join(uploadConfig.uploadRoot, 'chunks', fileHash);
}

function chunkPath(fileHash, chunkIndex) {
  return path.join(chunkDir(fileHash), String(chunkIndex));
}

function mergedPath(fileHash, fileName) {
  const ext = path.extname(fileName || '') || '.xlsx';
  return path.join(uploadConfig.uploadRoot, 'merged', `${fileHash}${ext}`);
}

async function ensureUploadDirs() {
  await fs.mkdir(path.join(uploadConfig.uploadRoot, 'meta'), { recursive: true });
  await fs.mkdir(path.join(uploadConfig.uploadRoot, 'chunks'), { recursive: true });
  await fs.mkdir(path.join(uploadConfig.uploadRoot, 'merged'), { recursive: true });
}

async function readMeta(fileHash) {
  try {
    const raw = await fs.readFile(metaPath(fileHash), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeMeta(fileHash, meta) {
  await ensureUploadDirs();
  await fs.writeFile(metaPath(fileHash), JSON.stringify(meta, null, 2), 'utf8');
}

async function listUploadedChunkIndexes(fileHash) {
  const dir = chunkDir(fileHash);
  try {
    const names = await fs.readdir(dir);
    return names
      .map((name) => Number.parseInt(name, 10))
      .filter((index) => Number.isInteger(index) && index >= 0)
      .sort((a, b) => a - b);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function checkUpload(input = {}) {
  const { fileHash, fileName, fileSize } = input;

  if (!isValidFileHash(fileHash)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'fileHash must be a 32-char md5 hex string');
  }
  if (typeof fileName !== 'string' || !fileName.trim()) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'fileName must be a non-empty string');
  }
  if (!Number.isInteger(fileSize) || fileSize <= 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'fileSize must be a positive integer');
  }
  if (fileSize > uploadConfig.maxFileBytes) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, `fileSize exceeds limit ${uploadConfig.maxFileBytes}`);
  }

  const meta = await readMeta(fileHash);
  if (meta && meta.merged && meta.mergedDocId) {
    return {
      fileExist: true,
      docId: meta.mergedDocId,
      uploadedChunks: Array.isArray(meta.uploadedChunks) ? meta.uploadedChunks : [],
    };
  }

  const uploadedChunks = await listUploadedChunkIndexes(fileHash);

  if (!meta) {
    await writeMeta(fileHash, {
      fileHash,
      fileName: fileName.trim(),
      fileSize,
      uploadedChunks,
      merged: false,
      mergedDocId: null,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    fileExist: false,
    uploadedChunks,
  };
}

async function saveChunk(input = {}) {
  const { fileHash, chunkIndex, chunkTotal, tempFilePath, fileSize } = input;

  if (!isValidFileHash(fileHash)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'fileHash must be a 32-char md5 hex string');
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'chunkIndex must be a non-negative integer');
  }
  if (!Number.isInteger(chunkTotal) || chunkTotal <= 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'chunkTotal must be a positive integer');
  }
  if (chunkIndex >= chunkTotal) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'chunkIndex out of range');
  }
  if (!tempFilePath) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'chunk file is required');
  }
  if (Number.isInteger(fileSize) && fileSize > uploadConfig.maxChunkBytes) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, `chunk exceeds limit ${uploadConfig.maxChunkBytes}`);
  }

  await ensureUploadDirs();
  await fs.mkdir(chunkDir(fileHash), { recursive: true });
  await fs.rename(tempFilePath, chunkPath(fileHash, chunkIndex));

  const uploadedChunks = await listUploadedChunkIndexes(fileHash);
  const meta = (await readMeta(fileHash)) || {
    fileHash,
    fileName: '',
    fileSize: 0,
    merged: false,
    mergedDocId: null,
  };

  meta.uploadedChunks = uploadedChunks;
  meta.updatedAt = new Date().toISOString();
  await writeMeta(fileHash, meta);

  return { chunkIndex, uploadedChunks };
}

async function mergeUpload(input = {}) {
  const {
    fileHash,
    fileName,
    fileSize,
    chunkTotal,
    createdBy,
    title,
    eventId,
  } = input;

  if (!isValidFileHash(fileHash)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'fileHash must be a 32-char md5 hex string');
  }
  if (typeof fileName !== 'string' || !fileName.trim()) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'fileName must be a non-empty string');
  }
  if (!Number.isInteger(fileSize) || fileSize <= 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'fileSize must be a positive integer');
  }
  if (!Number.isInteger(chunkTotal) || chunkTotal <= 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'chunkTotal must be a positive integer');
  }

  const meta = await readMeta(fileHash);
  if (meta && meta.merged && meta.mergedDocId) {
    return {
      url: mergedPath(fileHash, fileName),
      docId: meta.mergedDocId,
    };
  }

  const uploadedChunks = await listUploadedChunkIndexes(fileHash);
  const expected = Array.from({ length: chunkTotal }, (_, index) => index);
  const missing = expected.filter((index) => !uploadedChunks.includes(index));

  if (missing.length > 0) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'missing chunks', { missing });
  }

  await ensureUploadDirs();
  const outputPath = mergedPath(fileHash, fileName);
  const handle = await fs.open(outputPath, 'w');

  try {
    for (let index = 0; index < chunkTotal; index += 1) {
      const part = await fs.readFile(chunkPath(fileHash, index));
      await handle.write(part);
    }
  } finally {
    await handle.close();
  }

  const stat = await fs.stat(outputPath);
  if (stat.size !== fileSize) {
    await fs.unlink(outputPath).catch(() => {});
    throw createServiceError(
      ERROR_CODES.INVALID_PARAMS,
      `merged file size mismatch: expected ${fileSize}, got ${stat.size}`
    );
  }

  const docId = await excelUploadService.createDocFromMergedFile({
    mergedPath: outputPath,
    fileName: fileName.trim(),
    createdBy: typeof createdBy === 'string' ? createdBy : null,
    title: typeof title === 'string' ? title : undefined,
    eventId: typeof eventId === 'string' ? eventId : null,
  });

  await writeMeta(fileHash, {
    ...(meta || {}),
    fileHash,
    fileName: fileName.trim(),
    fileSize,
    chunkTotal,
    uploadedChunks,
    merged: true,
    mergedDocId: docId,
    mergedAt: new Date().toISOString(),
  });

  return {
    url: outputPath,
    docId,
  };
}

async function cancelUpload(input = {}) {
  const { fileHash } = input;

  if (!isValidFileHash(fileHash)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'fileHash must be a 32-char md5 hex string');
  }

  await fs.rm(chunkDir(fileHash), { recursive: true, force: true });
  await fs.rm(metaPath(fileHash), { force: true });

  return { cancelled: true };
}

module.exports = {
  ensureUploadDirs,
  checkUpload,
  saveChunk,
  mergeUpload,
  cancelUpload,
  isValidFileHash,
};
