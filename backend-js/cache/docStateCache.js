const cacheStore = require('./cacheStore');
const { docSeqKey } = require('./cacheKeys');

module.exports = {
  async get(docId) {
    return cacheStore.get(docSeqKey(docId));
  },

  async set(docId, record) {
    await cacheStore.set(docSeqKey(docId), { currentSeq: record.currentSeq });
  },

  async invalidate(docId) {
    await cacheStore.delete(docSeqKey(docId));
  },
};
