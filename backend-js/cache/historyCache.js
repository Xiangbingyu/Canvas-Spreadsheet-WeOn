const MAX_PER_DOC = 500;

// docId → { entries: Map<seq, entry>, minSeq: number, maxSeq: number }
const store = new Map();

function getDocBucket(docId) {
  if (!store.has(docId)) {
    store.set(docId, { entries: new Map(), minSeq: null, maxSeq: null });
  }
  return store.get(docId);
}

module.exports = {
  append(entry) {
    const bucket = getDocBucket(entry.docId);
    bucket.entries.set(entry.seq, entry);
    if (bucket.maxSeq === null || entry.seq > bucket.maxSeq) bucket.maxSeq = entry.seq;
    if (bucket.minSeq === null || entry.seq < bucket.minSeq) bucket.minSeq = entry.seq;

    // FIFO eviction
    if (bucket.entries.size > MAX_PER_DOC) {
      bucket.entries.delete(bucket.minSeq);
      let newMin = null;
      for (const s of bucket.entries.keys()) {
        if (newMin === null || s < newMin) newMin = s;
      }
      bucket.minSeq = newMin;
    }
  },

  // returns null on miss (caller must fall back to historyStore)
  listByDocIdSeqRange(docId, startExclusiveSeq, endInclusiveSeq) {
    const bucket = store.get(docId);
    if (!bucket) return null;
    if (bucket.maxSeq === null || bucket.maxSeq < endInclusiveSeq) return null;

    const results = [];
    for (let seq = startExclusiveSeq + 1; seq <= endInclusiveSeq; seq++) {
      if (!bucket.entries.has(seq)) return null; // gap → miss
      results.push(bucket.entries.get(seq));
    }
    return results;
  },

  getMaxCachedSeq(docId) {
    const bucket = store.get(docId);
    return bucket ? bucket.maxSeq : null;
  },

  invalidateByDocId(docId) {
    store.delete(docId);
  },
};
