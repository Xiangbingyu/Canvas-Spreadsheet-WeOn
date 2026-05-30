const idempotencyConfig = require('../config/idempotencyConfig');
const createMemoryEventIdStore = require('./memoryEventIdStore');
const createRedisEventIdStore = require('./redisEventIdStore');

module.exports = idempotencyConfig.driver === 'redis'
  ? createRedisEventIdStore()
  : createMemoryEventIdStore();
