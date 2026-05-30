const cacheConfig = require('../config/cacheConfig');
const cacheStore = require('./cacheStore');
const { docMetaKey } = require('./cacheKeys');

async function get(docId) {
  return cacheStore.get(docMetaKey(docId));
}

async function set(docId, meta) {
  await cacheStore.set(docMetaKey(docId), meta, {
    ttlMs: cacheConfig.docMetaTtlMs,
  });
}

async function invalidate(docId) {
  await cacheStore.delete(docMetaKey(docId));
}

module.exports = {
  get,
  set,
  invalidate,
};
