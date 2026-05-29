const { createRoomUser } = require('../../domain/entities/roomUser');
const { ensureMysqlReady, query, execute } = require('../../db/mysql');

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

function mapRowToRoomUser(row) {
  if (!row) {
    return null;
  }

  return createRoomUser({
    id: row.id,
    docId: row.doc_id,
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    status: row.status,
    joinedAt: toResponseDateTime(row.joined_at),
    lastActiveAt: toResponseDateTime(row.last_active_at),
  });
}

function createRoomUserMysqlStore() {
  async function ensureReady() {
    await ensureMysqlReady();
  }

  async function getStoredRow(docId, clientId) {
    await ensureReady();
    const [rows] = await query(
      `SELECT
        id,
        doc_id,
        client_id,
        name,
        color,
        status,
        joined_at,
        last_active_at
      FROM room_user
      WHERE doc_id = ? AND client_id = ?
      LIMIT 1`,
      [docId, clientId]
    );

    return mapRowToRoomUser(rows[0] || null);
  }

  async function saveRow(rowInput = {}) {
    await ensureReady();
    const current = rowInput.docId && rowInput.clientId
      ? await getStoredRow(rowInput.docId, rowInput.clientId)
      : null;

    const row = current
      ? createRoomUser({
        ...current,
        ...rowInput,
        id: current.id,
        docId: current.docId,
        clientId: current.clientId,
        joinedAt: current.joinedAt,
      })
      : createRoomUser(rowInput);

    await execute(
      `INSERT INTO room_user (
        doc_id,
        client_id,
        name,
        color,
        status,
        joined_at,
        last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        color = VALUES(color),
        status = VALUES(status),
        last_active_at = VALUES(last_active_at)`,
      [
        row.docId,
        row.clientId,
        row.name,
        row.color,
        row.status,
        toMysqlDateValue(row.joinedAt),
        toMysqlDateValue(row.lastActiveAt),
      ]
    );

    return getStoredRow(row.docId, row.clientId);
  }

  async function listByWhere(whereSql = '', params = [], orderSql = 'ORDER BY joined_at ASC') {
    await ensureReady();
    const [rows] = await query(
      `SELECT
        id,
        doc_id,
        client_id,
        name,
        color,
        status,
        joined_at,
        last_active_at
      FROM room_user
      ${whereSql}
      ${orderSql}`,
      params
    );

    return rows.map((row) => mapRowToRoomUser(row));
  }

  return {
    type: 'mysql',
    tableName: 'room_user',

    async create(rowInput = {}) {
      return saveRow(rowInput);
    },

    async upsert(rowInput = {}) {
      return saveRow(rowInput);
    },

    async findByDocIdAndClientId(docId, clientId) {
      return getStoredRow(docId, clientId);
    },

    async listByDocId(docId) {
      return listByWhere('WHERE doc_id = ?', [docId], 'ORDER BY joined_at ASC');
    },

    async listByClientId(clientId) {
      return listByWhere('WHERE client_id = ?', [clientId], 'ORDER BY last_active_at DESC');
    },

    async deleteByDocIdAndClientId(docId, clientId) {
      const current = await getStoredRow(docId, clientId);

      if (!current) {
        return false;
      }

      await saveRow({
        ...current,
        status: 'offline',
      });

      return true;
    },

    async upsertRoomUser(docId, user) {
      return saveRow({
        docId,
        ...user,
      });
    },

    async getRoomUsers(docId) {
      return listByWhere(
        'WHERE doc_id = ? AND status = ?',
        [docId, 'online'],
        'ORDER BY joined_at ASC'
      );
    },

    async removeRoomUser(docId, clientId) {
      return this.deleteByDocIdAndClientId(docId, clientId);
    },
  };
}

module.exports = createRoomUserMysqlStore;
