const cacheConfig = require('../config/cacheConfig');
const cacheStore = require('./cacheStore');
const { userDocsListKey, userDocsListPrefix } = require('./cacheKeys');

async function get(params) {
  return cacheStore.get(userDocsListKey(params));
}

async function set(params, value) {
  await cacheStore.set(userDocsListKey(params), value, {
    ttlMs: cacheConfig.userDocsListTtlMs,
  });
}

async function invalidateByUserId(userId) {
  await cacheStore.deleteByPrefix(userDocsListPrefix(userId));
}

module.exports = {
  get,
  set,
  invalidateByUserId,
};
