const appConfig = {
  port: Number(process.env.PORT || 3000),
  serviceName: 'backend-js',
  httpJsonLimit: process.env.HTTP_JSON_LIMIT || '20mb',
};

module.exports = appConfig;
