const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS doc (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    doc_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    snapshot_json JSON NOT NULL,
    current_seq BIGINT NOT NULL DEFAULT 0,
    created_by VARCHAR(64) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_doc_id (doc_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS history (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    doc_id VARCHAR(64) NOT NULL,
    seq BIGINT NOT NULL,
    base_seq BIGINT NULL,
    client_id VARCHAR(64) NULL,
    op_type VARCHAR(32) NOT NULL,
    target_sheet_id VARCHAR(64) NULL,
    target_row INT NULL,
    target_col INT NULL,
    old_value_json JSON NULL,
    new_value_json JSON NULL,
    old_style_json JSON NULL,
    new_style_json JSON NULL,
    payload_json JSON NULL,
    source_seq BIGINT NULL,
    event_id VARCHAR(128) NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_doc_seq (doc_id, seq),
    UNIQUE KEY uk_history_event_id (event_id),
    KEY idx_history_doc_client (doc_id, client_id),
    KEY idx_history_source_seq (doc_id, source_seq),
    KEY idx_history_doc_base_seq (doc_id, base_seq)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_op_state (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    doc_id VARCHAR(64) NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    undo_stack_json JSON NOT NULL,
    redo_stack_json JSON NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_doc_client (doc_id, client_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    doc_id VARCHAR(64) NULL,
    client_id VARCHAR(64) NULL,
    request_id VARCHAR(128) NULL,
    payload_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    KEY idx_audit_doc (doc_id),
    KEY idx_audit_client (client_id),
    KEY idx_audit_event_type (event_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS room_user (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    doc_id VARCHAR(64) NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    color VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    joined_at DATETIME(3) NOT NULL,
    last_active_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_room_user (doc_id, client_id),
    KEY idx_room_user_client (client_id),
    KEY idx_room_user_doc_status (doc_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS worker_consumer_checkpoint (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    consumer_name VARCHAR(128) NOT NULL,
    doc_id VARCHAR(64) NOT NULL,
    last_stream_id VARCHAR(64) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_worker_consumer_doc (consumer_name, doc_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS snapshot_checkpoint (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    doc_id VARCHAR(64) NOT NULL,
    checkpoint_seq BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    snapshot_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_snapshot_checkpoint_doc (doc_id),
    KEY idx_snapshot_checkpoint_seq (checkpoint_seq)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS doc_barrier_state (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    doc_id VARCHAR(64) NOT NULL,
    barrier_seq BIGINT NOT NULL,
    barrier_op_type VARCHAR(32) NOT NULL,
    event_id VARCHAR(128) NULL,
    payload_json JSON NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_doc_barrier_state_doc (doc_id),
    KEY idx_doc_barrier_state_seq (barrier_seq)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

function isIgnorableSchemaRaceError(error) {
  return Boolean(
    error
    && (
      error.code === 'ER_DUP_FIELDNAME'
      || error.code === 'ER_DUP_KEYNAME'
      || error.code === 'ER_DUP_ENTRY'
    )
  );
}

async function runSchemaMutation(pool, statement) {
  try {
    await pool.query(statement);
  } catch (error) {
    if (!isIgnorableSchemaRaceError(error)) {
      throw error;
    }
  }
}

async function hasColumn(pool, tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function hasIndex(pool, tableName, indexName) {
  const [rows] = await pool.query(
    `SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?`,
    [tableName, indexName]
  );

  return rows.length > 0;
}

async function ensureColumn(pool, {
  tableName,
  columnName,
  definition,
  afterColumn,
}) {
  if (await hasColumn(pool, tableName, columnName)) {
    return;
  }

  const afterClause = typeof afterColumn === 'string' && afterColumn
    ? ` AFTER ${afterColumn}`
    : '';

  await runSchemaMutation(
    pool,
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}${afterClause}`
  );
}

async function ensureIndex(pool, {
  tableName,
  indexName,
  definition,
}) {
  if (await hasIndex(pool, tableName, indexName)) {
    return;
  }

  await runSchemaMutation(
    pool,
    `ALTER TABLE ${tableName} ADD INDEX ${indexName} ${definition}`
  );
}

async function ensureHistoryBaseSeqColumn(pool) {
  await ensureColumn(pool, {
    tableName: 'history',
    columnName: 'base_seq',
    definition: 'BIGINT NULL',
    afterColumn: 'seq',
  });

  await ensureIndex(pool, {
    tableName: 'history',
    indexName: 'idx_history_doc_base_seq',
    definition: '(doc_id, base_seq)',
  });
}

async function ensureHistoryTargetSheetIdColumn(pool) {
  await ensureColumn(pool, {
    tableName: 'history',
    columnName: 'target_sheet_id',
    definition: 'VARCHAR(64) NULL',
    afterColumn: 'op_type',
  });
}

async function ensureMysqlSchema(pool) {
  for (const statement of schemaStatements) {
    await pool.query(statement);
  }

  await ensureHistoryBaseSeqColumn(pool);
  await ensureHistoryTargetSheetIdColumn(pool);
}

module.exports = {
  ensureMysqlSchema,
};
