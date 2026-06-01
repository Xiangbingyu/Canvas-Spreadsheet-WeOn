const collabConfig = require('../../config/collabConfig');
const { createUserOpState } = require('../../domain/entities/userOpState');
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

function getRetentionTtlMs() {
  return Number.isInteger(collabConfig.userOpStateTtlMs) && collabConfig.userOpStateTtlMs > 0
    ? collabConfig.userOpStateTtlMs
    : 30 * 60 * 1000;
}

function mapRowToUserOpState(row) {
  if (!row) {
    return null;
  }

  return createUserOpState({
    id: row.id,
    docId: row.doc_id,
    clientId: row.client_id,
    undoStackJson: parseJsonValue(row.undo_stack_json, []),
    redoStackJson: parseJsonValue(row.redo_stack_json, []),
    updatedAt: toResponseDateTime(row.updated_at),
  });
}

function createUserOpStateMysqlStore() {
  async function ensureReady() {
    await ensureMysqlReady();
  }

  async function purgeExpiredRows({ connection = null } = {}) {
    await ensureReady();
    const cutoffDate = new Date(Date.now() - getRetentionTtlMs());
    const executor = connection || { execute };
    await executor.execute('DELETE FROM user_op_state WHERE updated_at < ?', [cutoffDate]);
  }

  return {
    type: 'mysql',
    tableName: 'user_op_state',

    async create(rowInput = {}) {
      return this.upsert(rowInput);
    },

    async upsert(rowInput = {}) {
      return this.saveState(rowInput);
    },

    async findByDocIdAndClientId(docId, clientId, { connection = null } = {}) {
      await purgeExpiredRows({ connection });
      const executor = connection || { query };
      const [rows] = await executor.query(
        `SELECT
          id,
          doc_id,
          client_id,
          undo_stack_json,
          redo_stack_json,
          updated_at
        FROM user_op_state
        WHERE doc_id = ? AND client_id = ?
        LIMIT 1`,
        [docId, clientId]
      );

      return mapRowToUserOpState(rows[0] || null);
    },

    async list() {
      await purgeExpiredRows();
      const [rows] = await query(
        `SELECT
          id,
          doc_id,
          client_id,
          undo_stack_json,
          redo_stack_json,
          updated_at
        FROM user_op_state
        ORDER BY updated_at DESC`
      );

      return rows.map((row) => mapRowToUserOpState(row));
    },

    async getState(docId, clientId) {
      return this.findByDocIdAndClientId(docId, clientId);
    },

    async saveState(state = {}, { connection = null } = {}) {
      await purgeExpiredRows({ connection });
      const row = createUserOpState(state);
      const executor = connection || { execute };

      await executor.execute(
        `INSERT INTO user_op_state (
          doc_id,
          client_id,
          undo_stack_json,
          redo_stack_json,
          updated_at
        ) VALUES (?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)
        ON DUPLICATE KEY UPDATE
          undo_stack_json = VALUES(undo_stack_json),
          redo_stack_json = VALUES(redo_stack_json),
          updated_at = VALUES(updated_at)`,
        [
          row.docId,
          row.clientId,
          stringifyJsonValue(row.undoStackJson, []),
          stringifyJsonValue(row.redoStackJson, []),
          toMysqlDateValue(row.updatedAt),
        ]
      );

      return this.findByDocIdAndClientId(row.docId, row.clientId, { connection });
    },

    async deleteByDocIdAndClientId(docId, clientId) {
      await purgeExpiredRows();
      const [result] = await execute(
        'DELETE FROM user_op_state WHERE doc_id = ? AND client_id = ?',
        [docId, clientId]
      );

      return result.affectedRows > 0;
    },

    async clearByDocId(docId, { connection = null } = {}) {
      await purgeExpiredRows({ connection });
      const executor = connection || { execute };
      const updatedAt = new Date().toISOString();

      await executor.execute(
        `UPDATE user_op_state
        SET undo_stack_json = CAST(? AS JSON),
            redo_stack_json = CAST(? AS JSON),
            updated_at = ?
        WHERE doc_id = ?`,
        [
          stringifyJsonValue([], []),
          stringifyJsonValue([], []),
          toMysqlDateValue(updatedAt),
          docId,
        ]
      );

      const reader = connection || { query };
      const [rows] = await reader.query(
        `SELECT
          id,
          doc_id,
          client_id,
          undo_stack_json,
          redo_stack_json,
          updated_at
        FROM user_op_state
        WHERE doc_id = ?
        ORDER BY updated_at DESC`,
        [docId]
      );

      return rows.map((row) => mapRowToUserOpState(row));
    },

    async purgeExpired() {
      await purgeExpiredRows();
      return this.list();
    },
  };
}

module.exports = createUserOpStateMysqlStore;
