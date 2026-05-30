const { createAuditLog } = require('../../domain/entities/auditLog');
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

function mapRowToAuditLog(row) {
  if (!row) {
    return null;
  }

  return createAuditLog({
    id: row.id,
    eventType: row.event_type,
    docId: row.doc_id,
    clientId: row.client_id,
    requestId: row.request_id,
    payloadJson: parseJsonValue(row.payload_json, null),
    createdAt: row.created_at,
  });
}

function createAuditLogMysqlStore() {
  async function ensureReady() {
    await ensureMysqlReady();
  }

  async function listByWhere(whereSql = '', params = []) {
    await ensureReady();
    const [rows] = await query(
      `SELECT
        id,
        event_type,
        doc_id,
        client_id,
        request_id,
        payload_json,
        created_at
      FROM audit_log
      ${whereSql}
      ORDER BY created_at ASC, id ASC`,
      params
    );

    return rows.map((row) => mapRowToAuditLog(row));
  }

  return {
    type: 'mysql',
    tableName: 'audit_log',

    async create(rowInput = {}) {
      return this.append(rowInput);
    },

    async insert(rowInput = {}) {
      return this.append(rowInput);
    },

    async append(rowInput = {}) {
      await ensureReady();
      const row = createAuditLog(rowInput);

      const [result] = await execute(
        `INSERT INTO audit_log (
          event_type,
          doc_id,
          client_id,
          request_id,
          payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
        [
          row.eventType,
          row.docId,
          row.clientId,
          row.requestId,
          stringifyJsonValue(row.payloadJson, null),
          toMysqlDateValue(row.createdAt),
        ]
      );

      const [rows] = await query(
        `SELECT
          id,
          event_type,
          doc_id,
          client_id,
          request_id,
          payload_json,
          created_at
        FROM audit_log
        WHERE id = ?
        LIMIT 1`,
        [result.insertId]
      );

      return mapRowToAuditLog(rows[0] || null);
    },

    async list() {
      return listByWhere();
    },

    async listByDocId(docId) {
      return listByWhere('WHERE doc_id = ?', [docId]);
    },

    async listByClientId(clientId) {
      return listByWhere('WHERE client_id = ?', [clientId]);
    },

    async listByEventType(eventType) {
      return listByWhere('WHERE event_type = ?', [eventType]);
    },
  };
}

module.exports = createAuditLogMysqlStore;
