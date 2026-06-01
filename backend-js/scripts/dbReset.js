const { ensureMysqlReady, getPool, closePool } = require('../db/mysql');
const docSeedWriter = require('../db/seed/docSeedWriter');

const RESET_TABLES = [
  'history',
  'user_op_state',
  'audit_log',
  'room_user',
  'doc_barrier_state',
  'snapshot_checkpoint',
  'worker_consumer_checkpoint',
  'doc',
];

async function truncateTables(connection) {
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');

  try {
    for (const tableName of RESET_TABLES) {
      await connection.query(`TRUNCATE TABLE ${tableName}`);
    }
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

async function resetMysqlDatabase({
  closePoolAfterReset = true,
  silent = false,
} = {}) {
  await ensureMysqlReady();
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await truncateTables(connection);
    await docSeedWriter.run(connection);
    await connection.query('ALTER TABLE doc AUTO_INCREMENT = 1');
    if (!silent) {
      console.log('mysql reset completed with system seeds restored');
    }
  } finally {
    connection.release();

    if (closePoolAfterReset) {
      await closePool();
    }
  }
}

if (require.main === module) {
  resetMysqlDatabase().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  RESET_TABLES,
  truncateTables,
  resetMysqlDatabase,
};
