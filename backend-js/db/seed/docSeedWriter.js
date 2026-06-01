const { createDoc } = require('../../domain/entities/doc');
const { DOC_SEEDS } = require('./docSeed');

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

async function writeDocSeeds(connection) {
  for (let index = 0; index < DOC_SEEDS.length; index += 1) {
    const rowInput = DOC_SEEDS[index];
    const normalizedDoc = createDoc(rowInput);
    const seedId = -(index + 1);

    await connection.execute(
      `INSERT INTO doc (
        id,
        doc_id,
        title,
        snapshot_json,
        current_seq,
        created_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        snapshot_json = VALUES(snapshot_json),
        current_seq = VALUES(current_seq),
        created_by = VALUES(created_by),
        updated_at = VALUES(updated_at)`,
      [
        seedId,
        normalizedDoc.docId,
        normalizedDoc.title,
        stringifyJsonValue(normalizedDoc.snapshotJson, {}),
        normalizedDoc.currentSeq,
        normalizedDoc.createdBy,
        toMysqlDateValue(normalizedDoc.createdAt),
        toMysqlDateValue(normalizedDoc.updatedAt),
      ]
    );

    await connection.execute(
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
        toMysqlDateValue(normalizedDoc.createdAt),
        toMysqlDateValue(normalizedDoc.updatedAt),
      ]
    );
  }
}

module.exports = {
  id: 'doc_seed',
  async run(connection) {
    await writeDocSeeds(connection);
  },
};
