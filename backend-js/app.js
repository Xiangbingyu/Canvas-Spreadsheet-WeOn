﻿const express = require('express');

const healthRouter = require('./routes/health');
const docsRouter = require('./routes/docs');
const testPageRouter = require('./routes/testPage');
const appConfig = require('./config/appConfig');
const { ERROR_CODES } = require('./protocol/errorCodes');
const { applyHttpSecurity } = require('./security/httpGuard');
const { createHttpError } = require('./utils/response');

const app = express();

app.use('/docs', express.json({ limit: appConfig.docsHttpJsonLimit }));
app.use(express.json({ limit: appConfig.httpJsonLimit }));
applyHttpSecurity(app);

app.get('/', (req, res) => {
  res.json({
    code: 0,
    message: 'ok',
    data: {
      service: appConfig.serviceName,
    },
  });
});

app.use('/api-test', testPageRouter);
app.use('/health', healthRouter);
app.use('/docs', docsRouter);

app.use((error, req, res, next) => {
  if (!error) {
    return next();
  }

  if (error.type === 'entity.too.large') {
    const isDocsRequest = typeof req.originalUrl === 'string' && req.originalUrl.startsWith('/docs');

    return res
      .status(400)
      .json(createHttpError(
        ERROR_CODES.INVALID_PARAMS,
        `request body exceeds ${isDocsRequest ? appConfig.docsHttpJsonLimit : appConfig.httpJsonLimit}`
      ));
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res
      .status(400)
      .json(createHttpError(ERROR_CODES.INVALID_PARAMS, 'request body contains invalid JSON'));
  }

  return res
    .status(500)
    .json(createHttpError(ERROR_CODES.INTERNAL_ERROR, error.message || 'internal error'));
});

module.exports = app;
