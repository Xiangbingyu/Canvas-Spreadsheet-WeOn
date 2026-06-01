const { createDoc } = require('../../domain/entities/doc');

function cloneJsonValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function createSnapshotCheckpointMemoryStore() {
  const checkpointsByDocId = new Map();

  return {
    type: 'memory',
    tableName: 'snapshot_checkpoint_memory',

    async getLatestByDocId(docId) {
      return cloneJsonValue(checkpointsByDocId.get(docId) || null);
    },

    async saveCheckpoint(rowInput = {}) {
      const normalizedDoc = createDoc({
        docId: rowInput.docId,
        title: rowInput.title,
        snapshotJson: rowInput.snapshotJson,
        currentSeq: rowInput.checkpointSeq,
        createdAt: rowInput.createdAt,
        updatedAt: rowInput.updatedAt,
      });
      const checkpoint = {
        docId: normalizedDoc.docId,
        checkpointSeq: normalizedDoc.currentSeq,
        title: normalizedDoc.title,
        snapshotJson: normalizedDoc.snapshotJson,
        createdAt: rowInput.createdAt || normalizedDoc.updatedAt,
        updatedAt: normalizedDoc.updatedAt,
      };

      checkpointsByDocId.set(checkpoint.docId, checkpoint);
      return cloneJsonValue(checkpoint);
    },

    async clearByDocId(docId) {
      return checkpointsByDocId.delete(docId) ? 1 : 0;
    },
  };
}

module.exports = createSnapshotCheckpointMemoryStore;
