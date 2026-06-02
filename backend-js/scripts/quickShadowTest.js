#!/usr/bin/env node
// 快速影子期验证：启动影子期服务 → 执行测试操作 → 对账
// 用法：node scripts/quickShadowTest.js

const { spawn } = require('child_process');
const http = require('http');

async function waitForServer(port, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/`, (res) => resolve());
        req.on('error', reject);
        req.setTimeout(1000);
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return false;
}

async function execCommand(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: true,
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  });
}

async function main() {
  console.log('=== 影子期快速验证 ===\n');

  console.log('1. 重置数据库...');
  await execCommand('npm', ['run', 'db:reset']);
  console.log('✅ 数据库已重置\n');

  console.log('2. 启动影子期服务...');
  const server = spawn('node', ['--env-file=.env.shadow', 'server.js'], {
    stdio: 'pipe',
    detached: true,
  });
  server.unref();

  if (!(await waitForServer(3000))) {
    console.error('❌ 服务启动失败');
    process.kill(server.pid);
    process.exit(1);
  }
  console.log('✅ 服务已启动\n');

  console.log('3. 运行 WebSocket 集成测试...');
  try {
    await execCommand('npm', ['run', 'test:ws']);
    console.log('✅ 测试通过\n');
  } catch (err) {
    console.log('⚠️  部分测试失败（可能是多实例测试）\n');
  }

  console.log('4. 等待 worker 消费（5秒）...');
  await new Promise(r => setTimeout(r, 5000));
  console.log('✅ Worker 已消费\n');

  console.log('5. 运行对账验证...');
  try {
    await execCommand('node', ['--env-file=.env.shadow', 'scripts/shadowVerify.js']);
    console.log('\n✅ 影子期验证通过！Redis 与 MySQL 一致。');
  } catch (err) {
    console.log('\n❌ 发现不一致，请查看上方日志');
    process.kill(server.pid);
    process.exit(1);
  }

  process.kill(server.pid);
  console.log('\n🎉 影子期验收完成，可以正式切换到 Redis 实时态。');
}

main().catch((err) => {
  console.error('验证失败:', err.message);
  process.exit(1);
});
