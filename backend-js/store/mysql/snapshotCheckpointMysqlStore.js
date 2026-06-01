const { ensureMysqlReady, query, execute } = require('../../db/mysql');
const { createDoc, normalizeDocSnapshot } = require('../../domain/entities/doc');

function cloneJsonValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function parseJsonValue(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  return cloneJsonValue(value);
}

function stringifyJsonValue(value, fallback = null) {
  const normalizedValue = value === undefined ? fallback : value;
  return JSON.stringify(normalizedValue === undefined ? null : normalizedValue);
}

function toMysqlDateValue(value = new Date()) {
  if (value instanceof Date) {
    return value;
  }

  const normalizedDate = new Date(value);
  return Number.isNaN(normalizedDate.getTime()) ? new Date() : normalizedDate;
}

function toResponseDateTime(value) {
  if (typeof value === 'string' && value) {
    return value.replace(' ', 'T');
  }

  const normalizedDate = new Date(value);
  return Number.isNaN(normalizedDate.getTime()) ? new Date().toISOString() : normalizedDate.toISOString();
}

function mapRowToCheckpoint(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    docId: row.doc_id,
    checkpointSeq: Number(row.checkpoint_seq),
    title: row.title,
    snapshotJson: normalizeDocSnapshot(parseJsonValue(row.snapshot_json, null), { docId: row.doc_id }),
    createdAt: toResponseDateTime(row.created_at),
    updatedAt: toResponseDateTime(row.updated_at),
  };
}

function createSnapshotCheckpointMysqlStore() {
  async function ensureReady() {
    await ensureMysqlReady();
  }

  return {
    type: 'mysql',
    tableName: 'snapshot_checkpoint',

    async getLatestByDocId(docId, { connection = null } = {}) {
      await ensureReady();
      const executor = connection || { query };
      const [rows] = await executor.query(
        `SELECT
          id,
          doc_id,
          checkpoint_seq,
          title,
          snapshot_json,
          created_at,
          updated_at
        FROM snapshot_checkpoint
        WHERE doc_id = ?
        LIMIT 1`,
        [docId]
      );

      return mapRowToCheckpoint(rows[0] || null);
    },

    async saveCheckpoint(rowInput = {}, { connection = null } = {}) {
      await ensureReady();
      const executor = connection || { execute };
      const normalizedDoc = createDoc({
        docId: rowInput.docId,
        title: rowInput.title,
        snapshotJson: rowInput.snapshotJson,
        currentSeq: rowInput.checkpointSeq,
        createdAt: rowInput.createdAt,
        updatedAt: rowInput.updatedAt,
      });
      const createdAt = rowInput.createdAt || normalizedDoc.updatedAt;

      await executor.execute(
        `INSERT INTO snapshot_checkpoint (
          doc_id,
          checkpoint_seq,
          title,
          snapshot_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)
        ON DUPLICATE KEY UPDATE
          checkpoint_seq = VALUES(checkpoint_seq),
          title = VALUES(title),
          snapshot_json = VALUES(snapshot_json),
          updated_at = VALUES(updated_at)`,
        [
          normalizedDoc.docId,
          normalizedDoc.currentSeq,
          normalizedDoc.title,
          stringifyJsonValue(normalizedDoc.snapshotJson, {}),
          toMysqlDateValue(createdAt),
          toMysqlDateValue(normalizedDoc.updatedAt),
        ]
      );

      return this.getLatestByDocId(normalizedDoc.docId, { connection });
    },

    async clearByDocId(docId, { connection = null } = {}) {
      await ensureReady();
      const executor = connection || { execute };
      const [result] = await executor.execute(
        'DELETE FROM snapshot_checkpoint WHERE doc_id = ?',
        [docId]
      );
      return result.affectedRows;
    },
  };
}

module.exports = createSnapshotCheckpointMysqlStore;
