const cacheStore = require('./cacheStore');
const cacheConfig = require('../config/cacheConfig');
const { histEntryKey, histDocPrefix } = require('./cacheKeys');

function ttlMs() {
  return cacheConfig.historyTtlMs;
}

module.exports = {
  async append(entry) {
    await cacheStore.set(histEntryKey(entry.docId, entry.seq), entry, { ttlMs: ttlMs() });
  },

  async listByDocIdSeqRange(docId, startExclusiveSeq, endInclusiveSeq) {
    if (startExclusiveSeq >= endInclusiveSeq) return [];
    const seqs = [];
    for (let s = startExclusiveSeq + 1; s <= endInclusiveSeq; s++) seqs.push(s);
    const entries = await Promise.all(seqs.map((s) => cacheStore.get(histEntryKey(docId, s))));
    if (entries.some((e) => e === null)) return null; // any miss → fall back
    return entries;
  },

  getMaxCachedSeq() {
    return null; // not tracked in Redis mode; callers use listByDocIdSeqRange miss instead
  },

  async invalidateByDocId(docId) {
    await cacheStore.deleteByPrefix(histDocPrefix(docId));
  },
};
