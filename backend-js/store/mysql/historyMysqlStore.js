const { createHistory } = require('../../domain/entities/history');
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

function mapRowToHistory(row) {
  if (!row) {
    return null;
  }

  return createHistory({
    id: row.id,
    docId: row.doc_id,
    seq: Number(row.seq),
    baseSeq: row.base_seq === null ? null : Number(row.base_seq),
    clientId: row.client_id,
    opType: row.op_type,
    targetRow: row.target_row,
    targetCol: row.target_col,
    oldValueJson: parseJsonValue(row.old_value_json, null),
    newValueJson: parseJsonValue(row.new_value_json, null),
    oldStyleJson: parseJsonValue(row.old_style_json, null),
    newStyleJson: parseJsonValue(row.new_style_json, null),
    payloadJson: parseJsonValue(row.payload_json, null),
    sourceSeq: row.source_seq === null ? null : Number(row.source_seq),
    eventId: row.event_id,
    createdAt: row.created_at,
  });
}

function createHistoryMysqlStore() {
  async function ensureReady() {
    await ensureMysqlReady();
  }

  async function listByWhere(whereSql, params = [], { connection = null } = {}) {
    await ensureReady();
    const executor = connection || { query };
    const [rows] = await executor.query(
      `SELECT
        id,
        doc_id,
        seq,
        base_seq,
        client_id,
        op_type,
        target_row,
        target_col,
        old_value_json,
        new_value_json,
        old_style_json,
        new_style_json,
        payload_json,
        source_seq,
        event_id,
        created_at
      FROM history
      ${whereSql}
      ORDER BY seq ASC`,
      params
    );

    return rows.map((row) => mapRowToHistory(row));
  }

  return {
    type: 'mysql',
    tableName: 'history',

    async create(rowInput = {}) {
      return this.append(rowInput);
    },

    async insert(rowInput = {}) {
      return this.append(rowInput);
    },

    async append(rowInput = {}, { connection = null } = {}) {
      await ensureReady();
      const row = createHistory(rowInput);
      const executor = connection || { execute };

      await executor.execute(
        `INSERT INTO history (
          doc_id,
          seq,
          base_seq,
          client_id,
          op_type,
          target_row,
          target_col,
          old_value_json,
          new_value_json,
          old_style_json,
          new_style_json,
          payload_json,
          source_seq,
          event_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)`,
        [
          row.docId,
          row.seq,
          row.baseSeq,
          row.clientId,
          row.opType,
          row.targetRow,
          row.targetCol,
          stringifyJsonValue(row.oldValueJson, null),
          stringifyJsonValue(row.newValueJson, null),
          stringifyJsonValue(row.oldStyleJson, null),
          stringifyJsonValue(row.newStyleJson, null),
          stringifyJsonValue(row.payloadJson, null),
          row.sourceSeq,
          row.eventId,
          toMysqlDateValue(row.createdAt),
        ]
      );

      return this.findByDocIdAndSeq(row.docId, row.seq, { connection });
    },

    async findByDocIdAndSeq(docId, seq, { connection = null } = {}) {
      await ensureReady();
      const executor = connection || { query };
      const [rows] = await executor.query(
        `SELECT
          id,
          doc_id,
          seq,
          base_seq,
          client_id,
          op_type,
          target_row,
          target_col,
          old_value_json,
          new_value_json,
          old_style_json,
          new_style_json,
          payload_json,
          source_seq,
          event_id,
          created_at
        FROM history
        WHERE doc_id = ? AND seq = ?
        LIMIT 1`,
        [docId, seq]
      );

      return mapRowToHistory(rows[0] || null);
    },

    async getBySeq(docId, seq) {
      return this.findByDocIdAndSeq(docId, seq);
    },

    async findByEventId(eventId) {
      await ensureReady();
      const [rows] = await query(
        `SELECT
          id,
          doc_id,
          seq,
          base_seq,
          client_id,
          op_type,
          target_row,
          target_col,
          old_value_json,
          new_value_json,
          old_style_json,
          new_style_json,
          payload_json,
          source_seq,
          event_id,
          created_at
        FROM history
        WHERE event_id = ?
        LIMIT 1`,
        [eventId]
      );

      return mapRowToHistory(rows[0] || null);
    },

    async listByDocId(docId) {
      return listByWhere('WHERE doc_id = ?', [docId]);
    },

    async listByDocIdSeqRange(docId, startExclusiveSeq, endInclusiveSeq, { connection = null } = {}) {
      return listByWhere(
        'WHERE doc_id = ? AND seq > ? AND seq <= ?',
        [docId, startExclusiveSeq, endInclusiveSeq],
        { connection }
      );
    },

    async listByDocIdAndClientId(docId, clientId) {
      return listByWhere('WHERE doc_id = ? AND client_id = ?', [docId, clientId]);
    },

    async listBySourceSeq(docId, sourceSeq) {
      return listByWhere('WHERE doc_id = ? AND source_seq = ?', [docId, sourceSeq]);
    },
  };
}

module.exports = createHistoryMysqlStore;
