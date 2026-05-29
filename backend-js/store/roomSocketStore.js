const runtimeConfig = require('../config/runtimeConfig');
const createMemoryRoomSocketStore = require('./memory/roomSocketMemoryStore');
const createRoomSocketRedisStore = require('./redis/roomSocketRedisStore');

function createRoomSocketStore() {
  return runtimeConfig.driver === 'redis'
    ? createRoomSocketRedisStore()
    : createMemoryRoomSocketStore();
}

module.exports = createRoomSocketStore();
