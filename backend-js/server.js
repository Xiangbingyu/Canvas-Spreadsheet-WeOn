const http = require('http');

const app = require('./app');
const { createWebSocketServer } = require('./ws');

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

createWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
