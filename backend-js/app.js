const express = require('express');

const healthRouter = require('./routes/health');
const docsRouter = require('./routes/docs');

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    code: 0,
    message: 'ok',
    data: {
      service: 'backend-js',
    },
  });
});

app.use('/health', healthRouter);
app.use('/docs', docsRouter);

module.exports = app;
