﻿const http = require('http');

const app = require('./app');
const appConfig = require('./config/appConfig');
const { createWebSocketServer } = require('./ws');
const asyncWriteQueue = require('./infra/asyncWriteQueue');

const server = http.createServer(app);

createWebSocketServer(server);

asyncWriteQueue.start();

server.listen(appConfig.port, () => {
  console.log(`Server listening on port ${appConfig.port}`);
});
