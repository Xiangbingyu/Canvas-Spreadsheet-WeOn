const appConfig = {
  port: Number(process.env.PORT || 3000),
  serviceName: 'backend-js',
  httpJsonLimit: process.env.HTTP_JSON_LIMIT || '1mb',
  docsHttpJsonLimit: process.env.DOCS_HTTP_JSON_LIMIT || '20mb',
  httpRequestTimeoutMs: Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120000),
};

module.exports = appConfig;
