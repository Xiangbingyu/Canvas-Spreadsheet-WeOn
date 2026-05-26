const express = require('express');

const { ERROR_CODES, getHttpStatusByErrorCode } = require('../protocol/errorCodes');
const { isObject } = require('../protocol/validators');
const docsService = require('../service/docsService');
const { createHttpError, createHttpSuccess } = require('../utils/response');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const docs = await docsService.listDocsByUser({
      userId: req.query.userId,
      scope: req.query.scope,
      page: req.query.page,
      pageSize: req.query.pageSize || req.query.pagesize,
    });

    return res.json(createHttpSuccess(docs));
  } catch (error) {
    const errorCode = typeof error.code === 'number' ? error.code : ERROR_CODES.INTERNAL_ERROR;

    return res
      .status(getHttpStatusByErrorCode(errorCode))
      .json(createHttpError(errorCode, error.message || 'internal error', error.details || null));
  }
});

router.get('/:docId', async (req, res) => {
  try {
    const doc = await docsService.getDocState(req.params.docId);

    return res.json(createHttpSuccess(doc));
  } catch (error) {
    const errorCode = typeof error.code === 'number' ? error.code : ERROR_CODES.INTERNAL_ERROR;

    return res
      .status(getHttpStatusByErrorCode(errorCode))
      .json(createHttpError(errorCode, error.message || 'internal error', error.details || null));
  }
});

router.post('/', async (req, res) => {
  if (!isObject(req.body)) {
    return res
      .status(getHttpStatusByErrorCode(ERROR_CODES.INVALID_PARAMS))
      .json(createHttpError(ERROR_CODES.INVALID_PARAMS, 'request body must be an object'));
  }

  try {
    const doc = await docsService.createDoc({
      title: req.body.title,
      createdBy: req.body.createdBy,
      eventId: req.body.eventId,
    });

    return res.status(201).json(createHttpSuccess(doc));
  } catch (error) {
    const errorCode = typeof error.code === 'number' ? error.code : ERROR_CODES.INTERNAL_ERROR;

    return res
      .status(getHttpStatusByErrorCode(errorCode))
      .json(createHttpError(errorCode, error.message || 'internal error', error.details || null));
  }
});

module.exports = router;
