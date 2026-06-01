function cloneJsonValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function createDocBarrierMemoryStore() {
  const barriersByDocId = new Map();

  return {
    type: 'memory',
    tableName: 'doc_barrier_state_memory',

    async getByDocId(docId) {
      return cloneJsonValue(barriersByDocId.get(docId) || null);
    },

    async saveBarrier(rowInput = {}) {
      const barrier = {
        docId: rowInput.docId,
        seq: rowInput.seq,
        opType: rowInput.opType || 'import_sheet',
        eventId: rowInput.eventId || null,
        payloadJson: cloneJsonValue(rowInput.payloadJson || null),
        updatedAt: rowInput.updatedAt || new Date().toISOString(),
      };

      barriersByDocId.set(barrier.docId, barrier);
      return cloneJsonValue(barrier);
    },

    async clearByDocId(docId) {
      return barriersByDocId.delete(docId) ? 1 : 0;
    },
  };
}

module.exports = createDocBarrierMemoryStore;
