#!/usr/bin/env node
// 影子期快速验证脚本：启动服务 → 执行几轮 set_cell → 对账
// 用法：node scripts/shadowRun.js

const { spawn } = require('child_process');
const { createConnection } = require('mysql2/promise');

const MYSQL_CONFIG = {
  host: '127.0.0.1',
  port: 3310,
  user: 'app_user',
  password: 'app_password',
  database: 'canvas_spreadsheet',
};

async function checkMysql() {
  try {
    const conn = await createConnection(MYSQL_CONFIG);
    await conn.end();
    return true;
  } catch (err) {
    console.error('❌ MySQL 连接失败:', err.message);
    return false;
  }
}

async function checkRedis() {
  const redis = require('redis');
  const client = redis.createClient({ url: 'redis://127.0.0.1:6381' });
  try {
    await client.connect();
    await client.ping();
    await client.quit();
    return true;
  } catch (err) {
    console.error('❌ Redis 连接失败:', err.message);
    return false;
  }
}

async function runCommand(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  });
}

async function main() {
  console.log('=== 影子期验证流程 ===\n');

  console.log('1. 检查依赖...');
  const [mysqlOk, redisOk] = await Promise.all([checkMysql(), checkRedis()]);
  if (!mysqlOk || !redisOk) {
    console.error('\n请先启动 MySQL 和 Redis');
    process.exit(1);
  }
  console.log('✅ MySQL & Redis 就绪\n');

  console.log('2. 重置数据库...');
  await runCommand('npm', ['run', 'db:reset']);
  console.log('✅ 数据库已重置\n');

  console.log('3. 启动影子期服务（后台）...');
  const server = spawn('node', ['--env-file=.env.shadow', 'server.js'], {
    stdio: 'ignore',
    detached: true,
  });
  server.unref();
  await new Promise((r) => setTimeout(r, 2000));
  console.log('✅ 服务已启动 (PID: ' + server.pid + ')\n');

  console.log('4. 执行测试操作...');
  console.log('   (手动访问 http://localhost:3000 执行几轮 set_cell 操作)\n');
  console.log('5. 按任意键继续验证...');
  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });

  console.log('\n6. 运行对账脚本...');
  try {
    await runCommand('node', ['--env-file=.env.shadow', 'scripts/shadowVerify.js']);
    console.log('\n✅ 影子期验证通过！可以正式切换。');
  } catch (err) {
    console.log('\n❌ 发现不一致，请检查日志');
    process.exit(1);
  } finally {
    process.kill(server.pid);
  }
}

main().catch((err) => {
  console.error('验证失败:', err);
  process.exit(1);
});
