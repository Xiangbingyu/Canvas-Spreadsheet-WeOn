const { getPool, closePool } = require('./client');
const { ensureMysqlSchema } = require('./schema');

let initPromise = null;

async function ensureMysqlReady() {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = getPool();
      await pool.query('SELECT 1');
      await ensureMysqlSchema(pool);
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  return initPromise;
}

async function query(sql, params = []) {
  await ensureMysqlReady();
  return getPool().query(sql, params);
}

async function execute(sql, params = []) {
  await ensureMysqlReady();
  return getPool().execute(sql, params);
}

async function withTransaction(handler) {
  await ensureMysqlReady();
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function closeMysqlPool() {
  initPromise = null;
  await closePool();
}

module.exports = {
  ensureMysqlReady,
  getPool,
  query,
  execute,
  withTransaction,
  closePool: closeMysqlPool,
};
