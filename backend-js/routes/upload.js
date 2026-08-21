const express = require('express');
const fs = require('fs/promises');
const multer = require('multer');
const path = require('path');

const uploadConfig = require('../config/uploadConfig');
const { ERROR_CODES, getHttpStatusByErrorCode } = require('../protocol/errorCodes');
const { isObject } = require('../protocol/validators');
const uploadService = require('../service/uploadService');
const { createHttpError, createHttpSuccess } = require('../utils/response');

const router = express.Router();

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const fileHash = req.body && req.body.fileHash;
        if (!uploadService.isValidFileHash(fileHash)) {
          cb(new Error('invalid fileHash'));
          return;
        }

        const dir = path.join(uploadConfig.uploadRoot, 'chunks', fileHash);
        await fs.mkdir(dir, { recursive: true });
        cb(null, dir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const chunkIndex = req.body && req.body.chunkIndex;
      cb(null, String(chunkIndex));
    },
  }),
  limits: {
    fileSize: uploadConfig.maxChunkBytes,
  },
});

function handleRouteError(res, error) {
  const errorCode = typeof error.code === 'number' ? error.code : ERROR_CODES.INTERNAL_ERROR;

  return res
    .status(getHttpStatusByErrorCode(errorCode))
    .json(createHttpError(errorCode, error.message || 'internal error', error.details || null));
}

/** POST /api/upload/check — 秒传 + 断点查询 */
router.post('/check', async (req, res) => {
  if (!isObject(req.body)) {
    return res
      .status(getHttpStatusByErrorCode(ERROR_CODES.INVALID_PARAMS))
      .json(createHttpError(ERROR_CODES.INVALID_PARAMS, 'request body must be an object'));
  }

  try {
    const data = await uploadService.checkUpload({
      fileHash: req.body.fileHash,
      fileName: req.body.fileName,
      fileSize: Number(req.body.fileSize),
    });

    return res.json(createHttpSuccess(data));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

/** POST /api/upload/chunk — 上传单个分片（multipart） */
router.post('/chunk', chunkUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(getHttpStatusByErrorCode(ERROR_CODES.INVALID_PARAMS))
        .json(createHttpError(ERROR_CODES.INVALID_PARAMS, 'chunk file is required'));
    }

    const data = await uploadService.saveChunk({
      fileHash: req.body.fileHash,
      chunkIndex: Number.parseInt(req.body.chunkIndex, 10),
      chunkTotal: Number.parseInt(req.body.chunkTotal, 10),
      tempFilePath: req.file.path,
      fileSize: req.file.size,
    });

    return res.json(createHttpSuccess(data));
  } catch (error) {
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    return handleRouteError(res, error);
  }
});

/** POST /api/upload/merge — 合并分片并解析 Excel 创建文档 */
router.post('/merge', async (req, res) => {
  if (!isObject(req.body)) {
    return res
      .status(getHttpStatusByErrorCode(ERROR_CODES.INVALID_PARAMS))
      .json(createHttpError(ERROR_CODES.INVALID_PARAMS, 'request body must be an object'));
  }

  try {
    const data = await uploadService.mergeUpload({
      fileHash: req.body.fileHash,
      fileName: req.body.fileName,
      fileSize: Number(req.body.fileSize),
      chunkTotal: Number.parseInt(req.body.chunkTotal, 10),
      createdBy: req.body.createdBy,
      title: req.body.title,
      eventId: req.body.eventId,
    });

    return res.json(createHttpSuccess(data));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

/** POST /api/upload/cancel — 取消上传并清理临时分片 */
router.post('/cancel', async (req, res) => {
  if (!isObject(req.body)) {
    return res
      .status(getHttpStatusByErrorCode(ERROR_CODES.INVALID_PARAMS))
      .json(createHttpError(ERROR_CODES.INVALID_PARAMS, 'request body must be an object'));
  }

  try {
    const data = await uploadService.cancelUpload({
      fileHash: req.body.fileHash,
    });

    return res.json(createHttpSuccess(data));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

module.exports = router;
