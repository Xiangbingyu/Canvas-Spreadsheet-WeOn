const mysql = require('mysql2/promise');

const mysqlConfig = require('../../config/mysqlConfig');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      database: mysqlConfig.database,
      user: mysqlConfig.user,
      password: mysqlConfig.password,
      charset: mysqlConfig.charset,
      connectionLimit: mysqlConfig.connectionLimit,
      waitForConnections: true,
      dateStrings: true,
    });
  }

  return pool;
}

async function closePool() {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;
  await activePool.end();
}

module.exports = {
  getPool,
  closePool,
};
