const { createClient } = require('redis');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function getRedisUrl() {
  if (isNonEmptyString(process.env.REDIS_URL)) {
    return process.env.REDIS_URL.trim();
  }

  const host = isNonEmptyString(process.env.REDIS_HOST) ? process.env.REDIS_HOST.trim() : '127.0.0.1';
  const port = Number.parseInt(process.env.REDIS_PORT, 10);
  const normalizedPort = Number.isInteger(port) && port > 0 ? port : 6379;

  return `redis://${host}:${normalizedPort}`;
}

function createRedisConnection(name = 'redis-client') {
  const client = createClient({
    url: getRedisUrl(),
    username: isNonEmptyString(process.env.REDIS_USERNAME) ? process.env.REDIS_USERNAME.trim() : undefined,
    password: isNonEmptyString(process.env.REDIS_PASSWORD) ? process.env.REDIS_PASSWORD : undefined,
    socket: {
      reconnectStrategy(retries) {
        return Math.min(retries * 100, 1000);
      },
    },
  });

  client.on('error', (error) => {
    console.error(`${name} error:`, error);
  });

  return client;
}

module.exports = {
  getRedisUrl,
  createRedisConnection,
};
