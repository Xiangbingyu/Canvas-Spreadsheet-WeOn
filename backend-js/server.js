const http = require('http');

const app = require('./app');
const appConfig = require('./config/appConfig');
const uploadService = require('./service/uploadService');
const { createWebSocketServer } = require('./ws');

const server = http.createServer(app);

createWebSocketServer(server);

uploadService.ensureUploadDirs().catch((error) => {
  console.error('Failed to init upload directories:', error);
});

server.listen(appConfig.port, () => {
  console.log(`Server listening on port ${appConfig.port}`);
});
