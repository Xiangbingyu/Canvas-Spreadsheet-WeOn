﻿﻿﻿﻿﻿﻿﻿﻿﻿const express = require('express');

const healthRouter = require('./routes/health');
const docsRouter = require('./routes/docs');
const appConfig = require('./config/appConfig');
const { applyHttpSecurity } = require('./security/httpGuard');

const app = express();

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

app.use('/health', healthRouter);
app.use('/docs', docsRouter);

module.exports = app;
