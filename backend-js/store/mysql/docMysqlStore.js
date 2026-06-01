const {
  createDoc,
  normalizeDocSnapshot,
  createEmptySheetSnapshot,
  buildNextSheetId,
  buildDefaultSheetName,
} = require('../../domain/entities/doc');
const { ensureMysqlReady, query, execute, withTransaction } = require('../../db/mysql');
const { applySheetStructureChangeToSnapshot } = require('../../utils/sheetStructure');

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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function createStyleKey(style) {
  return stableStringify(style);
}

function nextStyleId(sheet) {
  const existingIds = Object.keys(sheet.styles || {});
  let maxStyleNumber = 0;

  for (const id of existingIds) {
    const match = /^style_(\d+)$/.exec(id);
    if (match) {
      maxStyleNumber = Math.max(maxStyleNumber, Number(match[1]));
    }
  }

  return `style_${String(maxStyleNumber + 1).padStart(3, '0')}`;
}

function findOrCreateStyleId(sheet, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return null;
  }

  const styleKey = createStyleKey(style);

  for (const [styleId, styleValue] of Object.entries(sheet.styles || {})) {
    if (createStyleKey(styleValue) === styleKey) {
      return styleId;
    }
  }

  const styleId = nextStyleId(sheet);
  sheet.styles[styleId] = JSON.parse(JSON.stringify(style));
  return styleId;
}

function resolveTargetSheet(nextSnapshot, preferredSheetId = null) {
  const requestedSheetId = typeof preferredSheetId === 'string' && preferredSheetId
    ? preferredSheetId
    : nextSnapshot.activeSheetId;

  if (!requestedSheetId || !nextSnapshot.sheets || !nextSnapshot.sheets[requestedSheetId]) {
    return {
      sheetId: null,
      sheet: null,
    };
  }

  return {
    sheetId: requestedSheetId,
    sheet: nextSnapshot.sheets[requestedSheetId],
  };
}

function mapRowToDoc(row) {
  if (!row) {
    return null;
  }

  return createDoc({
    id: row.id,
    docId: row.doc_id,
    title: row.title,
    snapshotJson: parseJsonValue(row.snapshot_json, null),
    currentSeq: Number(row.current_seq),
    createdBy: row.created_by,
    createdAt: toResponseDateTime(row.created_at),
    updatedAt: toResponseDateTime(row.updated_at),
  });
}

function createTemporaryDocId() {
  return `doc_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildFinalDocId(id) {
  return `doc_${String(id).padStart(3, '0')}`;
}

function createDocMysqlStore() {
  async function ensureReady() {
    await ensureMysqlReady();
  }

  async function runWithOptionalTransaction(handler, { connection = null } = {}) {
    if (connection) {
      return handler(connection);
    }

    return withTransaction(handler);
  }

  async function findByDocId(docId, { connection = null, forUpdate = false } = {}) {
    const executor = connection || { execute };
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.execute(
      `SELECT
        id,
        doc_id,
        title,
        snapshot_json,
        current_seq,
        created_by,
        created_at,
        updated_at
      FROM doc
      WHERE doc_id = ?${suffix}`,
      [docId]
    );

    return mapRowToDoc(rows[0] || null);
  }

  async function list() {
    await ensureReady();
    const [rows] = await query(
      `SELECT
        id,
        doc_id,
        title,
        snapshot_json,
        current_seq,
        created_by,
        created_at,
        updated_at
      FROM doc
      ORDER BY id ASC`
    );

    return rows.map((row) => mapRowToDoc(row));
  }

  async function createDocRow(rowInput = {}, options = {}) {
    await ensureReady();

    return runWithOptionalTransaction(async (connection) => {
      const temporaryDocId = rowInput.docId || createTemporaryDocId();
      const provisionalDoc = createDoc({
        ...rowInput,
        docId: temporaryDocId,
      });

      const [insertResult] = await connection.execute(
        `INSERT INTO doc (
          doc_id,
          title,
          snapshot_json,
          current_seq,
          created_by,
          created_at,
          updated_at
        ) VALUES (?, ?, CAST(? AS JSON), ?, ?, ?, ?)`,
        [
          provisionalDoc.docId,
          provisionalDoc.title,
          stringifyJsonValue(provisionalDoc.snapshotJson, {}),
          provisionalDoc.currentSeq,
          provisionalDoc.createdBy,
          toMysqlDateValue(provisionalDoc.createdAt),
          toMysqlDateValue(provisionalDoc.updatedAt),
        ]
      );

      const finalDoc = rowInput.docId
        ? provisionalDoc
        : createDoc({
          ...rowInput,
          id: insertResult.insertId,
          docId: buildFinalDocId(insertResult.insertId),
          createdAt: provisionalDoc.createdAt,
          updatedAt: provisionalDoc.updatedAt,
        });

      if (!rowInput.docId) {
        await connection.execute(
          `UPDATE doc
          SET doc_id = ?, snapshot_json = CAST(? AS JSON), updated_at = ?
          WHERE id = ?`,
          [
            finalDoc.docId,
            stringifyJsonValue(finalDoc.snapshotJson, {}),
            toMysqlDateValue(finalDoc.updatedAt),
            insertResult.insertId,
          ]
        );
      }

      return findByDocId(finalDoc.docId, { connection });
    }, options);
  }

  return {
    type: 'mysql',
    tableName: 'doc',

    async create(rowInput = {}) {
      return createDocRow(rowInput);
    },

    async insert(rowInput = {}) {
      return createDocRow(rowInput);
    },

    async createDoc(rowInput = {}) {
      return createDocRow(rowInput);
    },

    async findByDocId(docId) {
      await ensureReady();
      return findByDocId(docId);
    },

    async getByDocId(docId) {
      await ensureReady();
      return findByDocId(docId);
    },

    async list() {
      return list();
    },

    async updateByDocId(docId, patch = {}, options = {}) {
      await ensureReady();

      return runWithOptionalTransaction(async (connection) => {
        const current = await findByDocId(docId, { connection, forUpdate: true });

        if (!current) {
          return null;
        }

        const nextRow = createDoc({
          ...current,
          ...patch,
          id: current.id,
          docId: current.docId,
        });

        await connection.execute(
          `UPDATE doc
          SET title = ?, snapshot_json = CAST(? AS JSON), current_seq = ?, created_by = ?, created_at = ?, updated_at = ?
          WHERE id = ?`,
          [
            nextRow.title,
            stringifyJsonValue(nextRow.snapshotJson, {}),
            nextRow.currentSeq,
            nextRow.createdBy,
            toMysqlDateValue(nextRow.createdAt),
            toMysqlDateValue(nextRow.updatedAt),
            nextRow.id,
          ]
        );

        return findByDocId(docId, { connection });
      }, options);
    },

    async updateSnapshot(docId, snapshotJson, currentSeq, updatedAt) {
      return this.updateByDocId(docId, {
        snapshotJson: normalizeDocSnapshot(snapshotJson, { docId }),
        currentSeq,
        updatedAt,
      });
    },

    async getDocState(docId, options = {}) {
      await ensureReady();
      return findByDocId(docId, options);
    },

    async applySetCell(command, options = {}) {
      await ensureReady();

      return runWithOptionalTransaction(async (connection) => {
        const current = await findByDocId(command.docId, { connection, forUpdate: true });

        if (!current) {
          return null;
        }

        const nextSnapshot = normalizeDocSnapshot(current.snapshotJson, { docId: command.docId });
        const { sheetId: targetSheetId, sheet: targetSheet } = resolveTargetSheet(nextSnapshot, command.sheetId);

        if (!targetSheetId || !targetSheet) {
          return null;
        }

        const cellKey = `${command.row}:${command.col}`;
        const previousCell = targetSheet.cells[cellKey] || {};
        const oldValue = previousCell.value ?? '';
        const oldStyleId = typeof previousCell.styleId === 'string' ? previousCell.styleId : null;
        const oldStyle = oldStyleId ? JSON.parse(JSON.stringify(targetSheet.styles[oldStyleId] || null)) : null;
        const nextStyleIdValue = command.style !== undefined
          ? findOrCreateStyleId(targetSheet, command.style)
          : null;

        targetSheet.cells[cellKey] = {
          row: command.row,
          col: command.col,
          value: command.value ?? '',
          styleId: nextStyleIdValue,
        };

        if (command.row > targetSheet.rowCount) {
          targetSheet.rowCount = command.row;
        }

        if (command.col > targetSheet.colCount) {
          targetSheet.colCount = command.col;
        }

        const nextSeq = Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1;
        const updatedAt = new Date().toISOString();

        await connection.execute(
          `UPDATE doc
          SET snapshot_json = CAST(? AS JSON), current_seq = ?, updated_at = ?
          WHERE id = ?`,
          [
            stringifyJsonValue(nextSnapshot, {}),
            nextSeq,
            toMysqlDateValue(updatedAt),
            current.id,
          ]
        );

        const updatedDoc = await findByDocId(command.docId, { connection });
        return {
          ...updatedDoc,
          _before: { value: oldValue, style: oldStyle },
          _targetSheetId: targetSheetId,
        };
      }, options);
    },

    async applySetTitle(command, options = {}) {
      await ensureReady();

      return runWithOptionalTransaction(async (connection) => {
        const current = await findByDocId(command.docId, { connection, forUpdate: true });

        if (!current) {
          return null;
        }

        const nextSeq = Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1;
        const updatedAt = new Date().toISOString();

        await connection.execute(
          `UPDATE doc
          SET title = ?, current_seq = ?, updated_at = ?
          WHERE id = ?`,
          [
            command.title,
            nextSeq,
            toMysqlDateValue(updatedAt),
            current.id,
          ]
        );

        const updatedDoc = await findByDocId(command.docId, { connection });
        return { ...updatedDoc, _before: { title: current.title } };
      }, options);
    },

    async applySheetStructureChange(command, options = {}) {
      await ensureReady();

      return runWithOptionalTransaction(async (connection) => {
        const current = await findByDocId(command.docId, { connection, forUpdate: true });

        if (!current) {
          return null;
        }

        const structureResult = applySheetStructureChangeToSnapshot(current.snapshotJson, {
          docId: command.docId,
          sheetId: command.sheetId,
          opType: command.opType,
          row: command.row,
          col: command.col,
        });

        if (!structureResult.ok || !structureResult.targetSheetId) {
          return null;
        }

        const nextSeq = Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1;
        const updatedAt = new Date().toISOString();

        await connection.execute(
          `UPDATE doc
          SET snapshot_json = CAST(? AS JSON), current_seq = ?, updated_at = ?
          WHERE id = ?`,
          [
            stringifyJsonValue(structureResult.nextSnapshot, {}),
            nextSeq,
            toMysqlDateValue(updatedAt),
            current.id,
          ]
        );

        const updatedDoc = await findByDocId(command.docId, { connection });
        return {
          ...updatedDoc,
          _targetSheetId: structureResult.targetSheetId,
          _structureChange: {
            opType: command.opType,
            row: Number.isInteger(command.row) ? command.row : null,
            col: Number.isInteger(command.col) ? command.col : null,
          },
        };
      }, options);
    },

    async applyImportSheet(command, options = {}) {
      await ensureReady();

      return runWithOptionalTransaction(async (connection) => {
        const current = await findByDocId(command.docId, { connection, forUpdate: true });

        if (!current) {
          return null;
        }

        const nextSeq = Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1;
        const updatedAt = new Date().toISOString();
        const nextSnapshot = normalizeDocSnapshot(command.snapshotJson || command.snapshot, { docId: command.docId });

        await connection.execute(
          `UPDATE doc
          SET snapshot_json = CAST(? AS JSON), current_seq = ?, updated_at = ?
          WHERE id = ?`,
          [
            stringifyJsonValue(nextSnapshot, {}),
            nextSeq,
            toMysqlDateValue(updatedAt),
            current.id,
          ]
        );

        return findByDocId(command.docId, { connection });
      }, options);
    },

    async applyAddSheet(command, options = {}) {
      await ensureReady();

      return runWithOptionalTransaction(async (connection) => {
        const current = await findByDocId(command.docId, { connection, forUpdate: true });

        if (!current) {
          return null;
        }

        const nextSeq = Number.isInteger(command.seq) ? command.seq : current.currentSeq + 1;
        const updatedAt = new Date().toISOString();
        const nextSnapshot = normalizeDocSnapshot(current.snapshotJson, { docId: command.docId });
        const nextSheetId = buildNextSheetId(nextSnapshot, command.docId);
        const nextSheet = createEmptySheetSnapshot({
          docId: command.docId,
          sheetId: nextSheetId,
          name: command.sheetName || buildDefaultSheetName(nextSnapshot),
        });

        nextSnapshot.sheets[nextSheetId] = nextSheet;
        nextSnapshot.sheetOrder = [...(nextSnapshot.sheetOrder || []), nextSheetId];
        nextSnapshot.activeSheetId = nextSheetId;

        await connection.execute(
          `UPDATE doc
          SET snapshot_json = CAST(? AS JSON), current_seq = ?, updated_at = ?
          WHERE id = ?`,
          [
            stringifyJsonValue(nextSnapshot, {}),
            nextSeq,
            toMysqlDateValue(updatedAt),
            current.id,
          ]
        );

        const updatedDoc = await findByDocId(command.docId, { connection });
        return {
          ...updatedDoc,
          _addedSheet: JSON.parse(JSON.stringify(nextSheet)),
        };
      }, options);
    },
  };
}

module.exports = createDocMysqlStore;
