const mysqlConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE || 'canvas_spreadsheet',
  user: process.env.MYSQL_USER || 'app_user',
  password: process.env.MYSQL_PASSWORD || 'app_password',
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  charset: process.env.MYSQL_CHARSET || 'utf8mb4',
};

module.exports = mysqlConfig;
