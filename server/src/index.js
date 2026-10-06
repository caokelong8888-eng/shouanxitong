import { createApp } from './app.js';
import { config } from './config/index.js';
import { getDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { startImageGc } from './utils/image-gc-timer.js';

/**
 * 服务入口。
 * 启动时自动跑迁移，避免忘记建表导致接口全挂。
 */
function bootstrap() {
  const results = runMigrations();
  const applied = results.filter((r) => r.status === 'applied').map((r) => r.file);
  if (applied.length) console.log(`📦 已应用迁移: ${applied.join(', ')}`);

  // 触发一次连接，确认数据库可用
  getDb();

  const app = createApp();
  app.listen(config.port, () => {
    console.log('');
    console.log('  🏠 家庭智能收纳管理系统 · 服务已启动');
    console.log(`  ➜  API      http://localhost:${config.port}/api/health`);
    console.log(`  ➜  存储      ${config.storage.driver}  (${config.storage.localRoot})`);
    console.log(`  ➜  AI 识别   ${config.ai.driver}${config.ai.driver === 'mock' ? '  ← 占位模式，未接真实模型' : ''}`);
    console.log(`  ➜  数据库    ${config.dbPath}`);
    if (config.auth.passcode) {
      console.log('  ➜  访问口令   已启用 🔒');
    } else {
      console.log('');
      console.log('  ⚠️  警告：未设置 ACCESS_PASSCODE，接口没有任何保护！');
      console.log('      公网环境任何人知道地址就能读写数据，请尽快在 .env 里补上。');
    }
    console.log('');
  });

  // 孤儿图片清理：删东西只删数据库不删文件的问题，靠这个兜住
  startImageGc();
}

bootstrap();
