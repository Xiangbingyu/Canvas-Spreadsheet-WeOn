const { ensureMysqlReady, getPool, closePool } = require('../db/mysql');
const docSeedWriter = require('../db/seed/docSeedWriter');

async function main() {
  await ensureMysqlReady();
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await docSeedWriter.run(connection);
    console.log(`seed completed: ${docSeedWriter.id}`);
  } finally {
    connection.release();
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
