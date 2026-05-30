const cacheConfig = require('../config/cacheConfig');
const cacheStore = require('./cacheStore');
const { docSnapshotKey } = require('./cacheKeys');

async function get(docId) {
  return cacheStore.get(docSnapshotKey(docId));
}

async function set(docId, snapshot) {
  await cacheStore.set(docSnapshotKey(docId), snapshot, {
    ttlMs: cacheConfig.docSnapshotTtlMs,
  });
}

async function invalidate(docId) {
  await cacheStore.delete(docSnapshotKey(docId));
}

module.exports = {
  get,
  set,
  invalidate,
};
