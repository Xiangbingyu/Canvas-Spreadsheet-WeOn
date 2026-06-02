const http = require('http');

const app = require('./app');
const appConfig = require('./config/appConfig');
const { createWebSocketServer } = require('./ws');
const { startWorkers, stopWorkers } = require('./worker');

const server = http.createServer(app);

createWebSocketServer(server);

server.requestTimeout = appConfig.httpRequestTimeoutMs;
server.headersTimeout = Math.max(appConfig.httpRequestTimeoutMs + 5000, 65000);

server.listen(appConfig.port, async () => {
  console.log(`Server listening on port ${appConfig.port}`);
  await startWorkers();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await stopWorkers();
    server.close(() => process.exit(0));
  });
}
