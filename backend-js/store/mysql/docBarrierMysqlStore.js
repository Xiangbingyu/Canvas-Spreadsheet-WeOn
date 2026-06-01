const { ensureMysqlReady, query, execute } = require('../../db/mysql');

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

function mapRowToBarrier(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    docId: row.doc_id,
    seq: Number(row.barrier_seq),
    opType: row.barrier_op_type,
    eventId: row.event_id,
    payloadJson: parseJsonValue(row.payload_json, null),
    updatedAt: toResponseDateTime(row.updated_at),
  };
}

function createDocBarrierMysqlStore() {
  async function ensureReady() {
    await ensureMysqlReady();
  }

  return {
    type: 'mysql',
    tableName: 'doc_barrier_state',

    async getByDocId(docId, { connection = null } = {}) {
      await ensureReady();
      const executor = connection || { query };
      const [rows] = await executor.query(
        `SELECT
          id,
          doc_id,
          barrier_seq,
          barrier_op_type,
          event_id,
          payload_json,
          updated_at
        FROM doc_barrier_state
        WHERE doc_id = ?
        LIMIT 1`,
        [docId]
      );

      return mapRowToBarrier(rows[0] || null);
    },

    async saveBarrier(rowInput = {}, { connection = null } = {}) {
      await ensureReady();
      const executor = connection || { execute };
      const updatedAt = rowInput.updatedAt || new Date().toISOString();

      await executor.execute(
        `INSERT INTO doc_barrier_state (
          doc_id,
          barrier_seq,
          barrier_op_type,
          event_id,
          payload_json,
          updated_at
        ) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)
        ON DUPLICATE KEY UPDATE
          barrier_seq = VALUES(barrier_seq),
          barrier_op_type = VALUES(barrier_op_type),
          event_id = VALUES(event_id),
          payload_json = VALUES(payload_json),
          updated_at = VALUES(updated_at)`,
        [
          rowInput.docId,
          rowInput.seq,
          rowInput.opType || 'import_sheet',
          rowInput.eventId || null,
          stringifyJsonValue(rowInput.payloadJson, null),
          toMysqlDateValue(updatedAt),
        ]
      );

      return this.getByDocId(rowInput.docId, { connection });
    },

    async clearByDocId(docId, { connection = null } = {}) {
      await ensureReady();
      const executor = connection || { execute };
      const [result] = await executor.execute(
        'DELETE FROM doc_barrier_state WHERE doc_id = ?',
        [docId]
      );
      return result.affectedRows;
    },
  };
}

module.exports = createDocBarrierMysqlStore;
